import { REST, Routes } from "discord.js";
import * as setup from "./commands/setup.js";
import * as features from "./commands/features.js";
import * as questions from "./commands/questions.js";
import * as status from "./commands/status.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");

const clientId = process.env.DISCORD_CLIENT_ID;
if (!clientId) throw new Error("DISCORD_CLIENT_ID is not set");

const commands = [
  setup.data.toJSON(),
  features.data.toJSON(),
  questions.data.toJSON(),
  status.data.toJSON(),
];

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands...`);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log("✅ Slash commands registered successfully.");
  } catch (err) {
    console.error("Failed to register commands:", err);
    process.exit(1);
  }
})();
