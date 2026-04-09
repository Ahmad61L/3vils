import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import { getGuildConfig, getTrackedRoles } from "../database.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("View the current bot configuration and status")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild!;
  const config = getGuildConfig(guild.id);

  if (!config) {
    await interaction.reply({
      content: "Bot is not configured for this server. Use `/setup` to get started.",
      ephemeral: true,
    });
    return;
  }

  const trackedRoles = getTrackedRoles(guild.id);

  const featureStatus = (val: number) => (val ? "✅ Enabled" : "❌ Disabled");

  const embed = new EmbedBuilder()
    .setTitle("Bot Configuration Status")
    .setColor(0x5865f2)
    .addFields(
      {
        name: "Embed",
        value:
          `Channel: ${config.embed_channel_id ? `<#${config.embed_channel_id}>` : "Not set"}\n` +
          `Title: ${config.embed_title}\n` +
          `Footer suffix: ${config.embed_footer_suffix || "(none)"}`,
        inline: false,
      },
      {
        name: "Channels",
        value:
          `Log channel: ${config.log_channel_id ? `<#${config.log_channel_id}>` : "Not set"}\n` +
          `Ticket category: ${config.ticket_category_id ? `<#${config.ticket_category_id}>` : "Not set"}`,
        inline: false,
      },
      {
        name: "Tracked Roles",
        value:
          trackedRoles.length > 0
            ? trackedRoles
                .map(
                  (r) =>
                    `<@&${r.role_id}> — ${r.role_label}${r.is_dev_role ? " [dev]" : ""}${r.is_lowest_role ? " [entry]" : ""}`
                )
                .join("\n")
            : "None",
        inline: false,
      },
      {
        name: "Application Threshold",
        value: `Open when entry role < **${config.staff_open_threshold}** members`,
        inline: false,
      },
      {
        name: "Features",
        value:
          `Activity Tracking: ${featureStatus(config.feature_activity_tracking)}\n` +
          `Auto Promotion: ${featureStatus(config.feature_auto_promote)}\n` +
          `Staff Applications: ${featureStatus(config.feature_staff_applications)}\n` +
          `Developer Applications: ${featureStatus(config.feature_dev_applications)}\n` +
          `Ticket Creation: ${featureStatus(config.feature_tickets)}`,
        inline: false,
      }
    )
    .setFooter({ text: "Host: q7evn." })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
