import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { GuildMember } from "discord.js";
import { formatDuration } from "./embed-builder.js";

// Simple in-memory avatar cache (URL → Buffer)
const avatarCache = new Map<string, Buffer>();

function getAvatarUrl(member: GuildMember): string {
  const user = member.user;
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  }
  // Default avatar index — new username system uses (BigInt(id) >> 22n) % 6n
  let index: number;
  try {
    index = Number((BigInt(user.id) >> 22n) % 6n);
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function getStatusColor(status: string | undefined | null): string {
  switch (status) {
    case "online": return "#23a559";
    case "idle":   return "#f0b232";
    case "dnd":    return "#f23f43";
    default:       return "#80848e";
  }
}

function getStatusLabel(status: string | undefined | null): string {
  switch (status) {
    case "online": return "Online";
    case "idle":   return "Idle";
    case "dnd":    return "Do Not Disturb";
    default:       return "Offline";
  }
}

async function fetchAvatar(url: string): Promise<Buffer | null> {
  if (avatarCache.has(url)) return avatarCache.get(url)!;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    avatarCache.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

export interface MemberRow {
  member: GuildMember;
  activeSeconds: number;
  presenceStatus: string | null;
}

export interface RoleSection {
  label: string;
  applicationsOpen: boolean;
  isLowestRole: boolean;
  isDevRole: boolean;
  members: MemberRow[];
}

// Layout constants
const W = 580;
const PAD = 16;
const AVATAR = 42;
const ROW_H = 62;
const HEADER_H = 38;
const SECTION_GAP = 10;
const CORNER = 8;

// Colors
const BG        = "#1e1f22";
const CARD      = "#2b2d31";
const HEADER_BG = "#313338";
const WHITE     = "#f2f3f5";
const MUTED     = "#b5bac1";
const DIVIDER   = "#3f4147";
const GREEN_APP = "#23a559";
const RED_APP   = "#f23f43";

function roundRect(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCircleClip(
  ctx: SKRSContext2D,
  cx: number, cy: number, r: number
) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
}

export async function generateStaffImage(sections: RoleSection[]): Promise<Buffer> {
  // Pre-fetch all avatars in parallel
  const allMembers = sections.flatMap((s) => s.members);
  const avatarUrls = allMembers.map((m) => ({
    url: getAvatarUrl(m.member),
    key: m.member.id,
  }));
  await Promise.all(avatarUrls.map((a) => fetchAvatar(a.url)));

  // Calculate canvas height
  let totalHeight = PAD;
  for (const section of sections) {
    totalHeight += HEADER_H + Math.max(section.members.length, 1) * ROW_H + SECTION_GAP;
  }
  totalHeight += PAD;

  const canvas = createCanvas(W, totalHeight);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, totalHeight);

  let y = PAD;

  for (const section of sections) {
    const sectionH = HEADER_H + Math.max(section.members.length, 1) * ROW_H;

    // Section card background
    ctx.fillStyle = CARD;
    roundRect(ctx, PAD, y, W - PAD * 2, sectionH, CORNER);
    ctx.fill();

    // Role header bar
    ctx.fillStyle = HEADER_BG;
    roundRect(ctx, PAD, y, W - PAD * 2, HEADER_H, CORNER);
    ctx.fill();
    // flatten bottom corners of header
    ctx.fillRect(PAD, y + HEADER_H - CORNER, W - PAD * 2, CORNER);

    // Role label
    ctx.fillStyle = WHITE;
    ctx.font = "bold 14px sans-serif";
    ctx.textBaseline = "middle";
    const countLabel = `${section.label}  (${section.members.length})`;
    ctx.fillText(countLabel, PAD + 12, y + HEADER_H / 2);

    // Applications badge
    if (section.isLowestRole) {
      const badgeText = section.applicationsOpen ? "● Apps Open" : "● Apps Closed";
      const badgeColor = section.applicationsOpen ? GREEN_APP : RED_APP;
      const measured = ctx.measureText(countLabel).width;
      ctx.fillStyle = badgeColor;
      ctx.font = "12px sans-serif";
      ctx.fillText(badgeText, PAD + 12 + measured + 12, y + HEADER_H / 2);
    }
    if (section.isDevRole) {
      const measured = ctx.measureText(`${section.label}  (${section.members.length})`).width;
      ctx.fillStyle = section.members.length === 0 ? GREEN_APP : MUTED;
      ctx.font = "12px sans-serif";
      ctx.fillText(
        section.members.length === 0 ? "● Hiring" : "Developer Role",
        PAD + 12 + measured + 12,
        y + HEADER_H / 2
      );
    }

    y += HEADER_H;

    if (section.members.length === 0) {
      ctx.fillStyle = MUTED;
      ctx.font = "13px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("No members", PAD + 16, y + ROW_H / 2);
      y += ROW_H;
    } else {
      for (let i = 0; i < section.members.length; i++) {
        const row = section.members[i];
        const rowY = y + i * ROW_H;

        // Divider (not before first row)
        if (i > 0) {
          ctx.strokeStyle = DIVIDER;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD + AVATAR + PAD * 2, rowY);
          ctx.lineTo(W - PAD, rowY);
          ctx.stroke();
        }

        const cx = PAD + 14 + AVATAR / 2;
        const cy = rowY + ROW_H / 2;

        // Avatar
        const avatarUrl = getAvatarUrl(row.member);
        const avatarBuf = avatarCache.get(avatarUrl);

        ctx.save();
        drawCircleClip(ctx, cx, cy, AVATAR / 2);
        ctx.clip();

        if (avatarBuf) {
          try {
            const img = await loadImage(avatarBuf);
            ctx.drawImage(img as any, cx - AVATAR / 2, cy - AVATAR / 2, AVATAR, AVATAR);
          } catch {
            ctx.fillStyle = "#5865f2";
            ctx.fillRect(cx - AVATAR / 2, cy - AVATAR / 2, AVATAR, AVATAR);
          }
        } else {
          // Fallback: blurple circle with initial
          ctx.fillStyle = "#5865f2";
          ctx.fillRect(cx - AVATAR / 2, cy - AVATAR / 2, AVATAR, AVATAR);
          ctx.fillStyle = WHITE;
          ctx.font = `bold ${AVATAR * 0.4}px sans-serif`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillText(
            (row.member.displayName[0] ?? "?").toUpperCase(),
            cx,
            cy
          );
          ctx.textAlign = "left";
        }
        ctx.restore();

        // Status dot (bottom-right of avatar)
        const dotR = 7;
        const dotX = cx + AVATAR / 2 - dotR * 0.6;
        const dotY = cy + AVATAR / 2 - dotR * 0.6;

        // Outer ring (background punch)
        ctx.fillStyle = CARD;
        drawCircleClip(ctx, dotX, dotY, dotR + 2);
        ctx.fill();

        // Status color
        ctx.fillStyle = getStatusColor(row.presenceStatus);
        drawCircleClip(ctx, dotX, dotY, dotR);
        ctx.fill();

        // For idle: inner ring to make it look like half-moon
        // (keep simple colored dot)

        // Name
        const textX = PAD + 14 + AVATAR + 12;
        ctx.fillStyle = WHITE;
        ctx.font = "bold 14px sans-serif";
        ctx.textBaseline = "middle";
        const displayName = row.member.displayName;
        ctx.fillText(displayName, textX, rowY + ROW_H / 2 - 8);

        // Status label + activity
        ctx.fillStyle = MUTED;
        ctx.font = "12px sans-serif";
        const statusStr = getStatusLabel(row.presenceStatus);
        const actStr = row.activeSeconds > 0
          ? `  ·  ${formatDuration(row.activeSeconds)} active today`
          : "";
        ctx.fillText(statusStr + actStr, textX, rowY + ROW_H / 2 + 9);
      }

      y += section.members.length * ROW_H;
    }

    y += SECTION_GAP;
  }

  return canvas.toBuffer("image/png");
}
