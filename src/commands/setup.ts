import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import {
  ensureGuildConfig,
  updateGuildConfig,
  addTrackedRole,
  removeTrackedRole,
  clearTrackedRoles,
  getTrackedRoles,
  getGuildConfig,
} from "../database.js";
import { refreshEmbed } from "../embed-builder.js";

function parseRoleId(input: string): string | null {
  // Accept: <@&123456789>, @RoleName lookup not possible without guild, or raw ID
  const mentionMatch = input.match(/^<@&(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d{15,20}$/.test(input.trim())) return input.trim();
  return null;
}

function parseChannelId(input: string): string | null {
  const mentionMatch = input.match(/^<#(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d{15,20}$/.test(input.trim())) return input.trim();
  return null;
}

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure the staff tracking bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup((g) =>
    g
      .setName("roles")
      .setDescription("Manage tracked roles")
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Add a role to track (paste the role ID or @mention)")
          .addStringOption((o) =>
            o
              .setName("role_id")
              .setDescription("Role ID or @mention (e.g. 123456789 or @Moderator mention)")
              .setRequired(true)
          )
          .addStringOption((o) =>
            o.setName("label").setDescription("Display label for this role in the embed").setRequired(true)
          )
          .addIntegerOption((o) =>
            o.setName("order").setDescription("Display order — lower number = shown first (e.g. 1 for highest rank)").setRequired(true)
          )
          .addBooleanOption((o) =>
            o.setName("is_dev").setDescription("Mark as the developer role (triggers Apply for Developer button when empty)")
          )
          .addBooleanOption((o) =>
            o.setName("is_lowest").setDescription("Mark as the entry-level staff role (triggers Apply for Staff button)")
          )
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove a tracked role (paste the role ID or @mention)")
          .addStringOption((o) =>
            o
              .setName("role_id")
              .setDescription("Role ID or @mention to remove")
              .setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s.setName("list").setDescription("List all currently tracked roles")
      )
      .addSubcommand((s) =>
        s.setName("clear").setDescription("Clear all tracked roles")
      )
  )
  .addSubcommandGroup((g) =>
    g
      .setName("embed")
      .setDescription("Configure the staff embed message")
      .addSubcommand((s) =>
        s
          .setName("channel")
          .setDescription("Set the channel for the staff embed (paste channel ID or #mention)")
          .addStringOption((o) =>
            o
              .setName("channel_id")
              .setDescription("Channel ID or #mention (e.g. 123456789 or #channel mention)")
              .setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("title")
          .setDescription("Set the embed title")
          .addStringOption((o) =>
            o.setName("title").setDescription("New title text").setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("footer")
          .setDescription("Add extra text to the footer (always includes 'Host: q7evn.')")
          .addStringOption((o) =>
            o.setName("text").setDescription("Extra text to append after 'Host: q7evn.'").setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("post")
          .setDescription("Post or refresh the staff embed in the configured channel")
      )
  )
  .addSubcommandGroup((g) =>
    g
      .setName("config")
      .setDescription("General bot configuration")
      .addSubcommand((s) =>
        s
          .setName("log_channel")
          .setDescription("Set the log channel for bot actions")
          .addStringOption((o) =>
            o
              .setName("channel_id")
              .setDescription("Channel ID or #mention")
              .setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("ticket_category")
          .setDescription("Set the category where ticket channels are created")
          .addStringOption((o) =>
            o
              .setName("category_id")
              .setDescription("Category ID (copy ID from Discord)")
              .setRequired(true)
          )
      )
      .addSubcommand((s) =>
        s
          .setName("thresholds")
          .setDescription("Set when staff applications open/close based on member count")
          .addIntegerOption((o) =>
            o
              .setName("open_below")
              .setDescription("Open applications when entry role member count is BELOW this number")
              .setRequired(true)
          )
      )
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild!;
  ensureGuildConfig(guild.id);

  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  if (group === "roles") {
    if (sub === "add") {
      const rawInput = interaction.options.getString("role_id")!;
      const roleId = parseRoleId(rawInput);

      if (!roleId) {
        await interaction.reply({
          content: `❌ Could not parse a role ID from \`${rawInput}\`.\n\n**How to get a role ID:**\n1. Enable Developer Mode in Discord Settings → Advanced\n2. Go to Server Settings → Roles\n3. Right-click (or long-press) the role and tap "Copy Role ID"\n\nThen paste that number here.`,
          ephemeral: true,
        });
        return;
      }

      // Verify the role actually exists in this guild
      await guild.roles.fetch();
      const role = guild.roles.cache.get(roleId);
      if (!role) {
        await interaction.reply({
          content: `❌ No role with ID \`${roleId}\` found in this server. Make sure you copied the correct role ID.`,
          ephemeral: true,
        });
        return;
      }

      const label = interaction.options.getString("label")!;
      const order = interaction.options.getInteger("order")!;
      const isDev = interaction.options.getBoolean("is_dev") ?? false;
      const isLowest = interaction.options.getBoolean("is_lowest") ?? false;

      addTrackedRole(guild.id, roleId, label, order, isDev, isLowest);
      await refreshEmbed(interaction.client, guild.id);
      await interaction.reply({
        content: `✅ **${role.name}** added as **${label}** (order: ${order}${isDev ? ", developer role" : ""}${isLowest ? ", entry role" : ""}).`,
        ephemeral: true,
      });
    } else if (sub === "remove") {
      const rawInput = interaction.options.getString("role_id")!;
      const roleId = parseRoleId(rawInput);

      if (!roleId) {
        await interaction.reply({
          content: `❌ Could not parse a role ID from \`${rawInput}\`. Paste the numeric role ID.`,
          ephemeral: true,
        });
        return;
      }

      removeTrackedRole(guild.id, roleId);
      await refreshEmbed(interaction.client, guild.id);
      await interaction.reply({
        content: `✅ Role <@&${roleId}> removed from tracking.`,
        ephemeral: true,
      });
    } else if (sub === "list") {
      const roles = getTrackedRoles(guild.id);
      if (roles.length === 0) {
        await interaction.reply({ content: "No roles are being tracked yet.", ephemeral: true });
        return;
      }
      const lines = roles.map(
        (r) =>
          `• <@&${r.role_id}> — **${r.role_label}** (order: ${r.role_order}${r.is_dev_role ? ", dev" : ""}${r.is_lowest_role ? ", entry" : ""})`
      );
      await interaction.reply({
        content: `**Tracked Roles:**\n${lines.join("\n")}`,
        ephemeral: true,
      });
    } else if (sub === "clear") {
      clearTrackedRoles(guild.id);
      await refreshEmbed(interaction.client, guild.id);
      await interaction.reply({ content: "✅ All tracked roles cleared.", ephemeral: true });
    }
  } else if (group === "embed") {
    if (sub === "channel") {
      const rawInput = interaction.options.getString("channel_id")!;
      const channelId = parseChannelId(rawInput);

      if (!channelId) {
        await interaction.reply({
          content: `❌ Could not parse a channel ID from \`${rawInput}\`.\n\n**How to get a channel ID:**\n1. Enable Developer Mode in Discord Settings → Advanced\n2. Long-press the channel and tap "Copy Channel ID"`,
          ephemeral: true,
        });
        return;
      }

      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        await interaction.reply({
          content: `❌ No channel with ID \`${channelId}\` found in this server.`,
          ephemeral: true,
        });
        return;
      }

      updateGuildConfig(guild.id, {
        embed_channel_id: channelId,
        embed_message_id: null,
      });
      await interaction.reply({
        content: `✅ Embed channel set to <#${channelId}>. Use \`/setup embed post\` to post the embed.`,
        ephemeral: true,
      });
    } else if (sub === "title") {
      const title = interaction.options.getString("title")!;
      updateGuildConfig(guild.id, { embed_title: title });
      await refreshEmbed(interaction.client, guild.id);
      await interaction.reply({ content: `✅ Embed title updated to **${title}**.`, ephemeral: true });
    } else if (sub === "footer") {
      const text = interaction.options.getString("text")!;
      updateGuildConfig(guild.id, { embed_footer_suffix: text });
      await refreshEmbed(interaction.client, guild.id);
      await interaction.reply({
        content: `✅ Footer updated — it will show: *Host: q7evn. • ${text}*`,
        ephemeral: true,
      });
    } else if (sub === "post") {
      const config = getGuildConfig(guild.id);
      if (!config?.embed_channel_id) {
        await interaction.reply({
          content: "❌ Set an embed channel first with `/setup embed channel`.",
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      await refreshEmbed(interaction.client, guild.id);
      await interaction.editReply({ content: "✅ Embed posted/refreshed!" });
    }
  } else if (group === "config") {
    if (sub === "log_channel") {
      const rawInput = interaction.options.getString("channel_id")!;
      const channelId = parseChannelId(rawInput);
      if (!channelId) {
        await interaction.reply({ content: `❌ Could not parse a channel ID from \`${rawInput}\`.`, ephemeral: true });
        return;
      }
      updateGuildConfig(guild.id, { log_channel_id: channelId });
      await interaction.reply({ content: `✅ Log channel set to <#${channelId}>.`, ephemeral: true });
    } else if (sub === "ticket_category") {
      const rawInput = interaction.options.getString("category_id")!;
      const categoryId = rawInput.trim();
      if (!/^\d{15,20}$/.test(categoryId)) {
        await interaction.reply({
          content: `❌ \`${rawInput}\` doesn't look like a valid category ID. Right-click the category in Discord and select "Copy Category ID".`,
          ephemeral: true,
        });
        return;
      }
      updateGuildConfig(guild.id, { ticket_category_id: categoryId });
      await interaction.reply({ content: `✅ Ticket category set.`, ephemeral: true });
    } else if (sub === "thresholds") {
      const openBelow = interaction.options.getInteger("open_below")!;
      updateGuildConfig(guild.id, { staff_open_threshold: openBelow });
      await refreshEmbed(interaction.client, guild.id);
      await interaction.reply({
        content: `✅ Applications will open when the entry staff role has fewer than **${openBelow}** members.`,
        ephemeral: true,
      });
    }
  }
}
