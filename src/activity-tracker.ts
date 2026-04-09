import { Client, GuildMember, PresenceStatus } from "discord.js";
import { upsertActivity, getTrackedRoles, getGuildConfig } from "./database.js";
import { refreshEmbed } from "./embed-builder.js";
import { checkAutoPromote } from "./auto-promote.js";

const activeTimers = new Map<string, { start: number }>();

function makeKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

export function startTracking(guildId: string, userId: string) {
  const key = makeKey(guildId, userId);
  if (!activeTimers.has(key)) {
    activeTimers.set(key, { start: Math.floor(Date.now() / 1000) });
    upsertActivity(guildId, userId, {
      is_active: 1,
      last_seen: Math.floor(Date.now() / 1000),
    });
  }
}

export function stopTracking(guildId: string, userId: string) {
  const key = makeKey(guildId, userId);
  const timer = activeTimers.get(key);
  if (timer) {
    const elapsed = Math.floor(Date.now() / 1000) - timer.start;
    activeTimers.delete(key);
    upsertActivity(guildId, userId, {
      active_seconds: elapsed,
      is_active: 0,
      last_seen: Math.floor(Date.now() / 1000),
    });
  }
}

export function recordMessage(guildId: string, userId: string) {
  const now = Math.floor(Date.now() / 1000);
  upsertActivity(guildId, userId, {
    message_count: 1,
    last_seen: now,
    is_active: 1,
  });
  startTracking(guildId, userId);
}

export function isOnlineStatus(status: PresenceStatus | "offline"): boolean {
  return status === "online" || status === "idle" || status === "dnd";
}

export function setupActivityTracking(client: Client) {
  client.on("presenceUpdate", async (oldPresence, newPresence) => {
    if (!newPresence.guild || !newPresence.member) return;
    const guild = newPresence.guild;
    const config = getGuildConfig(guild.id);
    if (!config || !config.feature_activity_tracking) return;

    const trackedRoles = getTrackedRoles(guild.id);
    if (trackedRoles.length === 0) return;

    const member = newPresence.member;
    const hasTrackedRole = trackedRoles.some((r) =>
      member.roles.cache.has(r.role_id)
    );
    if (!hasTrackedRole) return;

    const wasOnline = oldPresence ? isOnlineStatus(oldPresence.status) : false;
    const isNowOnline = isOnlineStatus(newPresence.status);

    if (!wasOnline && isNowOnline) {
      startTracking(guild.id, member.id);
    } else if (wasOnline && !isNowOnline) {
      stopTracking(guild.id, member.id);
      await refreshEmbed(client, guild.id);
    }
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    const config = getGuildConfig(message.guild.id);
    if (!config || !config.feature_activity_tracking) return;

    const trackedRoles = getTrackedRoles(message.guild.id);
    if (trackedRoles.length === 0) return;

    const member = message.member;
    if (!member) return;

    const hasTrackedRole = trackedRoles.some((r) =>
      member.roles.cache.has(r.role_id)
    );
    if (!hasTrackedRole) return;

    recordMessage(message.guild.id, message.author.id);
  });

  // Flush active timers every 60 seconds and refresh embed
  setInterval(async () => {
    for (const [key, timer] of activeTimers.entries()) {
      const [guildId, userId] = key.split(":");
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - timer.start;
      upsertActivity(guildId, userId, {
        active_seconds: elapsed,
        is_active: 1,
        last_seen: now,
      });
      // Reset timer
      activeTimers.set(key, { start: now });
    }

    // Refresh all guild embeds
    const guildIds = new Set<string>();
    for (const key of activeTimers.keys()) {
      guildIds.add(key.split(":")[0]);
    }
    for (const guildId of guildIds) {
      await refreshEmbed(client, guildId);
    }
  }, 60_000);

  // Check auto-promote every 10 minutes
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const config = getGuildConfig(guild.id);
      if (!config || !config.feature_auto_promote) continue;
      await checkAutoPromote(client, guild);
    }
  }, 600_000);

  // Initialize presence tracking on startup — stagger guilds to avoid rate limits
  client.once("clientReady", async () => {
    const guilds = [...client.guilds.cache.values()];
    for (let i = 0; i < guilds.length; i++) {
      const guild = guilds[i];
      // Stagger: wait 2s between guilds
      if (i > 0) await new Promise((r) => setTimeout(r, 2000));

      const config = getGuildConfig(guild.id);
      if (!config || !config.feature_activity_tracking) continue;
      const trackedRoles = getTrackedRoles(guild.id);
      if (trackedRoles.length === 0) continue;

      try {
        await guild.members.fetch();
      } catch {
        continue;
      }

      for (const [, member] of guild.members.cache) {
        const hasTrackedRole = trackedRoles.some((r) =>
          member.roles.cache.has(r.role_id)
        );
        if (!hasTrackedRole) continue;

        const presence = member.presence;
        if (presence && isOnlineStatus(presence.status)) {
          startTracking(guild.id, member.id);
        }
      }
    }
  });
}
