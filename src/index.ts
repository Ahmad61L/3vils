import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChatInputCommandInteraction,
  ButtonInteraction,
  REST,
  Routes,
  Collection,
} from "discord.js";
import * as setup from "./commands/setup.js";
import * as features from "./commands/features.js";
import * as questions from "./commands/questions.js";
import * as status from "./commands/status.js";
import { setupActivityTracking } from "./activity-tracker.js";
import { handleApplyButton } from "./tickets.js";
import { refreshEmbed } from "./embed-builder.js";
import { getGuildConfig, ensureGuildConfig } from "./database.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("❌ DISCORD_BOT_TOKEN is not set");
  process.exit(1);
}

const commands = new Collection<string, { data: any; execute: Function }>([
  ["setup", setup],
  ["features", features],
  ["questions", questions],
  ["status", status],
]);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once("clientReady", async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`Serving ${c.guilds.cache.size} guild(s)`);

  // Auto-register slash commands using the bot's app ID
  const clientId = c.user.id;
  const rest = new REST().setToken(token!);
  const commandList = [
    setup.data.toJSON(),
    features.data.toJSON(),
    questions.data.toJSON(),
    status.data.toJSON(),
  ];

  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(clientId), { body: commandList });
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }

  // Refresh embeds for all guilds on startup
  for (const guild of c.guilds.cache.values()) {
    ensureGuildConfig(guild.id);
    const config = getGuildConfig(guild.id);
    if (config?.embed_channel_id) {
      await refreshEmbed(client, guild.id);
    }
  }
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`Joined guild: ${guild.name} (${guild.id})`);
  ensureGuildConfig(guild.id);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const config = getGuildConfig(member.guild.id);
  if (config?.embed_channel_id) {
    await refreshEmbed(client, member.guild.id);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  const config = getGuildConfig(member.guild.id);
  if (config?.embed_channel_id) {
    await refreshEmbed(client, member.guild.id);
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  // Check if roles changed
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());
  const changed =
    [...oldRoles].some((r) => !newRoles.has(r)) ||
    [...newRoles].some((r) => !oldRoles.has(r));

  if (changed) {
    const config = getGuildConfig(newMember.guild.id);
    if (config?.embed_channel_id) {
      await refreshEmbed(client, newMember.guild.id);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = commands.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction as ChatInputCommandInteraction);
    } catch (err) {
      console.error(`Error in /${interaction.commandName}:`, err);
      const reply = { content: "❌ An error occurred.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  } else if (interaction.isButton()) {
    const btn = interaction as ButtonInteraction;
    if (btn.customId === "apply_staff") {
      await handleApplyButton(client, btn, "staff");
    } else if (btn.customId === "apply_developer") {
      await handleApplyButton(client, btn, "developer");
    }
  }
});

setupActivityTracking(client);

client.login(token);
