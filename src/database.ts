import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "bot.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    embed_channel_id TEXT,
    embed_message_id TEXT,
    embed_title TEXT DEFAULT 'Staff & Developer Team',
    embed_footer_suffix TEXT DEFAULT '',
    log_channel_id TEXT,
    ticket_category_id TEXT,
    -- Feature toggles (1 = enabled, 0 = disabled)
    feature_activity_tracking INTEGER DEFAULT 1,
    feature_auto_promote INTEGER DEFAULT 1,
    feature_staff_applications INTEGER DEFAULT 1,
    feature_dev_applications INTEGER DEFAULT 1,
    feature_tickets INTEGER DEFAULT 1,
    -- Application thresholds
    staff_open_threshold INTEGER DEFAULT 5,
    staff_close_threshold INTEGER DEFAULT 10,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS tracked_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    role_label TEXT NOT NULL,
    role_order INTEGER DEFAULT 0,
    is_dev_role INTEGER DEFAULT 0,
    is_lowest_role INTEGER DEFAULT 0,
    UNIQUE(guild_id, role_id)
  );

  CREATE TABLE IF NOT EXISTS member_activity (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    active_seconds INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    last_seen INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, date)
  );

  CREATE TABLE IF NOT EXISTS application_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('staff', 'developer')),
    question_order INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    UNIQUE(guild_id, type, question_order)
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('staff', 'developer')),
    channel_id TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    answers TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    decided_at INTEGER,
    decided_by TEXT
  );

  CREATE TABLE IF NOT EXISTS promotion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    from_role_id TEXT,
    to_role_id TEXT NOT NULL,
    reason TEXT,
    promoted_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`);

export { db };

export function getGuildConfig(guildId: string) {
  return db
    .prepare("SELECT * FROM guild_config WHERE guild_id = ?")
    .get(guildId) as GuildConfig | undefined;
}

export function ensureGuildConfig(guildId: string): GuildConfig {
  const existing = getGuildConfig(guildId);
  if (existing) return existing;
  db.prepare(
    "INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)"
  ).run(guildId);
  return getGuildConfig(guildId)!;
}

export function updateGuildConfig(
  guildId: string,
  data: Partial<Omit<GuildConfig, "guild_id">>
) {
  ensureGuildConfig(guildId);
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const setClauses = keys.map((k) => `${k} = ?`).join(", ");
  const values = Object.values(data);
  db.prepare(
    `UPDATE guild_config SET ${setClauses}, updated_at = strftime('%s', 'now') WHERE guild_id = ?`
  ).run(...values, guildId);
}

export function getTrackedRoles(guildId: string): TrackedRole[] {
  return db
    .prepare(
      "SELECT * FROM tracked_roles WHERE guild_id = ? ORDER BY role_order ASC"
    )
    .all(guildId) as TrackedRole[];
}

export function addTrackedRole(
  guildId: string,
  roleId: string,
  label: string,
  order: number,
  isDevRole = false,
  isLowestRole = false
) {
  db.prepare(
    `INSERT OR REPLACE INTO tracked_roles 
     (guild_id, role_id, role_label, role_order, is_dev_role, is_lowest_role) 
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(guildId, roleId, label, order, isDevRole ? 1 : 0, isLowestRole ? 1 : 0);
}

export function removeTrackedRole(guildId: string, roleId: string) {
  db.prepare(
    "DELETE FROM tracked_roles WHERE guild_id = ? AND role_id = ?"
  ).run(guildId, roleId);
}

export function clearTrackedRoles(guildId: string) {
  db.prepare("DELETE FROM tracked_roles WHERE guild_id = ?").run(guildId);
}

export function getTodayActivity(guildId: string, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .prepare(
      "SELECT * FROM member_activity WHERE guild_id = ? AND user_id = ? AND date = ?"
    )
    .get(guildId, userId, today) as MemberActivity | undefined;
}

export function upsertActivity(
  guildId: string,
  userId: string,
  delta: Partial<MemberActivity>
) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = getTodayActivity(guildId, userId);
  if (!existing) {
    db.prepare(
      `INSERT INTO member_activity (guild_id, user_id, date, active_seconds, message_count, last_seen, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      guildId,
      userId,
      today,
      delta.active_seconds ?? 0,
      delta.message_count ?? 0,
      delta.last_seen ?? Math.floor(Date.now() / 1000),
      delta.is_active ?? 0
    );
  } else {
    const newSeconds =
      (existing.active_seconds ?? 0) + (delta.active_seconds ?? 0);
    const newMsgs =
      (existing.message_count ?? 0) + (delta.message_count ?? 0);
    db.prepare(
      `UPDATE member_activity SET 
        active_seconds = ?, message_count = ?, 
        last_seen = ?, is_active = ?
       WHERE guild_id = ? AND user_id = ? AND date = ?`
    ).run(
      newSeconds,
      newMsgs,
      delta.last_seen ?? existing.last_seen,
      delta.is_active ?? existing.is_active,
      guildId,
      userId,
      today
    );
  }
}

export function getDefaultQuestions(type: "staff" | "developer"): string[] {
  if (type === "staff") {
    return [
      "What is your age and timezone?",
      "How long have you been in this server and why do you want to be staff?",
      "Do you have any previous moderation experience? If so, describe it.",
      "How would you handle a situation where two members are arguing aggressively?",
      "A member is spamming the chat — what steps do you take?",
      "How do you handle a report about a rule violation you are unsure about?",
      "What does fair and consistent moderation mean to you?",
      "How many hours per week can you dedicate to moderating?",
      "Have you ever had to deal with a troll or a raid? How did you handle it?",
      "Is there anything else you would like us to know about you?",
    ];
  } else {
    return [
      "What programming languages or technologies are you proficient in?",
      "Describe a project you have built — what problem did it solve?",
      "Do you have experience with Discord bots or APIs? Give details.",
      "How do you approach debugging and fixing errors in your code?",
      "Why do you want to join this server's development team?",
    ];
  }
}

export function getQuestions(
  guildId: string,
  type: "staff" | "developer"
): string[] {
  const rows = db
    .prepare(
      `SELECT question_text FROM application_questions 
       WHERE guild_id = ? AND type = ? 
       ORDER BY question_order ASC`
    )
    .all(guildId, type) as { question_text: string }[];
  if (rows.length === 0) return getDefaultQuestions(type);
  return rows.map((r) => r.question_text);
}

export function setQuestions(
  guildId: string,
  type: "staff" | "developer",
  questions: string[]
) {
  const del = db.prepare(
    "DELETE FROM application_questions WHERE guild_id = ? AND type = ?"
  );
  const ins = db.prepare(
    `INSERT INTO application_questions (guild_id, type, question_order, question_text) VALUES (?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    del.run(guildId, type);
    questions.forEach((q, i) => ins.run(guildId, type, i + 1, q));
  });
  tx();
}

export function createApplication(
  guildId: string,
  userId: string,
  type: "staff" | "developer",
  channelId: string
) {
  const result = db
    .prepare(
      `INSERT INTO applications (guild_id, user_id, type, channel_id) VALUES (?, ?, ?, ?)`
    )
    .run(guildId, userId, type, channelId);
  return result.lastInsertRowid as number;
}

export function getOpenApplication(guildId: string, userId: string) {
  return db
    .prepare(
      `SELECT * FROM applications WHERE guild_id = ? AND user_id = ? AND status = 'pending'`
    )
    .get(guildId, userId) as Application | undefined;
}

export function updateApplication(
  id: number,
  data: Partial<Application>
) {
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const setClauses = keys.map((k) => `${k} = ?`).join(", ");
  const values = Object.values(data);
  db.prepare(`UPDATE applications SET ${setClauses} WHERE id = ?`).run(
    ...values,
    id
  );
}

export function getApplication(id: number) {
  return db
    .prepare("SELECT * FROM applications WHERE id = ?")
    .get(id) as Application | undefined;
}

export function getApplicationByChannel(channelId: string) {
  return db
    .prepare("SELECT * FROM applications WHERE channel_id = ?")
    .get(channelId) as Application | undefined;
}

export function logPromotion(
  guildId: string,
  userId: string,
  fromRoleId: string | null,
  toRoleId: string,
  reason: string
) {
  db.prepare(
    `INSERT INTO promotion_log (guild_id, user_id, from_role_id, to_role_id, reason) VALUES (?, ?, ?, ?, ?)`
  ).run(guildId, userId, fromRoleId, toRoleId, reason);
}

export interface GuildConfig {
  guild_id: string;
  embed_channel_id: string | null;
  embed_message_id: string | null;
  embed_title: string;
  embed_footer_suffix: string;
  log_channel_id: string | null;
  ticket_category_id: string | null;
  feature_activity_tracking: number;
  feature_auto_promote: number;
  feature_staff_applications: number;
  feature_dev_applications: number;
  feature_tickets: number;
  staff_open_threshold: number;
  staff_close_threshold: number;
  updated_at: number;
}

export interface TrackedRole {
  id: number;
  guild_id: string;
  role_id: string;
  role_label: string;
  role_order: number;
  is_dev_role: number;
  is_lowest_role: number;
}

export interface MemberActivity {
  guild_id: string;
  user_id: string;
  date: string;
  active_seconds: number;
  message_count: number;
  last_seen: number;
  is_active: number;
}

export interface Application {
  id: number;
  guild_id: string;
  user_id: string;
  type: "staff" | "developer";
  channel_id: string | null;
  status: "pending" | "approved" | "rejected";
  answers: string | null;
  created_at: number;
  decided_at: number | null;
  decided_by: string | null;
}
