import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Guild,
  TextChannel,
  AttachmentBuilder,
} from "discord.js";
import {
  getGuildConfig,
  getTrackedRoles,
  getTodayActivity,
  GuildConfig,
  TrackedRole,
} from "./database.js";
import { generateStaffImage, RoleSection, MemberRow } from "./image-generator.js";

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export async function buildStaffEmbed(
  client: Client,
  guild: Guild,
  config: GuildConfig,
  trackedRoles: TrackedRole[]
) {
  const embed = new EmbedBuilder()
    .setTitle(config.embed_title || "Staff & Developer Team")
    .setColor(0x5865f2)
    .setTimestamp();

  const footerText = config.embed_footer_suffix
    ? `Host: q7evn. • ${config.embed_footer_suffix}`
    : "Host: q7evn.";
  embed.setFooter({ text: footerText });

  if (trackedRoles.length === 0) {
    embed.setDescription(
      "*No roles are being tracked. Use `/setup roles` to configure.*"
    );
    return { embeds: [embed], components: [], files: [] };
  }

  let lowestRoleHasMembers = false;
  let devRoleEmpty = false;
  let totalStaffCount = 0;

  const sections: RoleSection[] = [];

  for (const trackedRole of trackedRoles) {
    const role = guild.roles.cache.get(trackedRole.role_id);
    if (!role) continue;

    const members = role.members;

    // Accumulate total staff across all tracked roles
    totalStaffCount += members.size;

    if (trackedRole.is_lowest_role) {
      lowestRoleHasMembers = members.size > 0;
    }
    if (trackedRole.is_dev_role) {
      devRoleEmpty = members.size === 0;
    }

    const staffOpen =
      trackedRole.is_lowest_role &&
      config.feature_staff_applications &&
      members.size < config.staff_open_threshold;

    const memberRows: MemberRow[] = [];
    for (const [, member] of members) {
      const activity = getTodayActivity(guild.id, member.id);
      const activeSeconds = activity?.active_seconds ?? 0;
      const presenceStatus = member.presence?.status ?? null;

      memberRows.push({
        member,
        activeSeconds,
        presenceStatus,
      });
    }

    // Sort: online members first, then by active time descending
    memberRows.sort((a, b) => {
      const aOnline = ["online", "idle", "dnd"].includes(a.presenceStatus ?? "");
      const bOnline = ["online", "idle", "dnd"].includes(b.presenceStatus ?? "");
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      return b.activeSeconds - a.activeSeconds;
    });

    sections.push({
      label: trackedRole.role_label,
      applicationsOpen: !!staffOpen,
      isLowestRole: !!trackedRole.is_lowest_role,
      isDevRole: !!trackedRole.is_dev_role,
      members: memberRows,
    });
  }

  // Generate staff image with avatars
  let imageBuffer: Buffer | null = null;
  try {
    imageBuffer = await generateStaffImage(sections);
  } catch (err) {
    console.error("Failed to generate staff image:", err);
  }

  const files: AttachmentBuilder[] = [];
  if (imageBuffer) {
    files.push(new AttachmentBuilder(imageBuffer, { name: "staff.png" }));
    embed.setImage("attachment://staff.png");
  }

  // Determine required votes for display
  const requiredVotes = totalStaffCount >= 5 ? 5 : totalStaffCount >= 3 ? 3 : 1;

  // Add minimal text fields for role summary (for screen readers / mobile previews)
  for (const section of sections) {
    const count = section.members.length;
    let fieldName = `${section.label} — ${count} member${count !== 1 ? "s" : ""}`;
    if (section.isLowestRole) {
      const canApply = totalStaffCount >= 10;
      if (section.applicationsOpen && canApply) {
        fieldName += `  ✅ Apps Open  (${requiredVotes} votes needed)`;
      } else if (section.applicationsOpen && !canApply) {
        fieldName += `  ⏳ Apps Unavailable — need 10 staff (${totalStaffCount}/10)`;
      } else {
        fieldName += "  ❌ Apps Closed";
      }
    }
    if (section.isDevRole) {
      fieldName += count === 0 ? "  🔍 Hiring" : "  💻 Dev Role";
    }
    embed.addFields({ name: fieldName, value: "\u200b", inline: false });
  }

  // Buttons
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const buttons: ButtonBuilder[] = [];

  // Apply button only appears when there are at least 10 total staff to review applications
  const MIN_STAFF_FOR_APPS = 10;
  if (config.feature_staff_applications && lowestRoleHasMembers && totalStaffCount >= MIN_STAFF_FOR_APPS) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("apply_staff")
        .setLabel("Apply for Staff")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📋")
    );
  }

  if (config.feature_dev_applications && devRoleEmpty) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("apply_developer")
        .setLabel("Apply for Developer")
        .setStyle(ButtonStyle.Success)
        .setEmoji("💻")
    );
  }

  if (buttons.length > 0) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  }

  return { embeds: [embed], components, files };
}

// Debounce map: guildId → timer
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function refreshEmbed(client: Client, guildId: string, delayMs = 2000): void {
  // Cancel any pending refresh for this guild
  const existing = refreshTimers.get(guildId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    refreshTimers.delete(guildId);
    doRefreshEmbed(client, guildId).catch((err) =>
      console.error("Error refreshing embed:", err)
    );
  }, delayMs);

  refreshTimers.set(guildId, timer);
}

async function doRefreshEmbed(client: Client, guildId: string) {
  const config = getGuildConfig(guildId);
  if (!config?.embed_channel_id) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(config.embed_channel_id) as TextChannel | null;
  if (!channel) return;

  const trackedRoles = getTrackedRoles(guildId);
  const payload = await buildStaffEmbed(client, guild, config, trackedRoles);

  // Delete old message (can't replace attachments via edit)
  if (config.embed_message_id) {
    try {
      const msg = await channel.messages.fetch(config.embed_message_id);
      await msg.delete();
    } catch {
      // Message not found — will create fresh
    }
  }

  const msg = await channel.send(payload as any);
  const { updateGuildConfig } = await import("./database.js");
  updateGuildConfig(guildId, { embed_message_id: msg.id });
}
