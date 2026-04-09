import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { ensureGuildConfig, updateGuildConfig, getGuildConfig } from "../database.js";
import { refreshEmbed } from "../embed-builder.js";

export const data = new SlashCommandBuilder()
  .setName("features")
  .setDescription("Enable or disable bot features")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o
      .setName("feature")
      .setDescription("Which feature to toggle")
      .setRequired(true)
      .addChoices(
        { name: "Activity Tracking", value: "activity_tracking" },
        { name: "Auto Promotion", value: "auto_promote" },
        { name: "Staff Applications", value: "staff_applications" },
        { name: "Developer Applications", value: "dev_applications" },
        { name: "Ticket Creation", value: "tickets" }
      )
  )
  .addBooleanOption((o) =>
    o
      .setName("enabled")
      .setDescription("Enable or disable this feature")
      .setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild!;
  ensureGuildConfig(guild.id);

  const feature = interaction.options.getString("feature")!;
  const enabled = interaction.options.getBoolean("enabled")!;
  const value = enabled ? 1 : 0;

  const featureMap: Record<string, string> = {
    activity_tracking: "feature_activity_tracking",
    auto_promote: "feature_auto_promote",
    staff_applications: "feature_staff_applications",
    dev_applications: "feature_dev_applications",
    tickets: "feature_tickets",
  };

  const featureLabels: Record<string, string> = {
    activity_tracking: "Activity Tracking",
    auto_promote: "Auto Promotion",
    staff_applications: "Staff Applications",
    dev_applications: "Developer Applications",
    tickets: "Ticket Creation",
  };

  const dbKey = featureMap[feature];
  updateGuildConfig(guild.id, { [dbKey]: value });

  await refreshEmbed(interaction.client, guild.id);

  const statusText = enabled ? "✅ **Enabled**" : "❌ **Disabled**";
  await interaction.reply({
    content: `${statusText} — **${featureLabels[feature]}**`,
    ephemeral: true,
  });
}
