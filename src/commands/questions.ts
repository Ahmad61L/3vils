import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import {
  getQuestions,
  setQuestions,
  getDefaultQuestions,
} from "../database.js";

export const data = new SlashCommandBuilder()
  .setName("questions")
  .setDescription("Manage application questions")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) =>
    s
      .setName("list")
      .setDescription("View the current questions for an application type")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Application type")
          .setRequired(true)
          .addChoices(
            { name: "Staff", value: "staff" },
            { name: "Developer", value: "developer" }
          )
      )
  )
  .addSubcommand((s) =>
    s
      .setName("reset")
      .setDescription("Reset questions to defaults")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Application type")
          .setRequired(true)
          .addChoices(
            { name: "Staff", value: "staff" },
            { name: "Developer", value: "developer" }
          )
      )
  )
  .addSubcommand((s) =>
    s
      .setName("set")
      .setDescription("Set a single question (provide all questions you want)")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Application type")
          .setRequired(true)
          .addChoices(
            { name: "Staff", value: "staff" },
            { name: "Developer", value: "developer" }
          )
      )
      .addStringOption((o) =>
        o
          .setName("q1")
          .setDescription("Question 1")
          .setRequired(true)
      )
      .addStringOption((o) => o.setName("q2").setDescription("Question 2"))
      .addStringOption((o) => o.setName("q3").setDescription("Question 3"))
      .addStringOption((o) => o.setName("q4").setDescription("Question 4"))
      .addStringOption((o) => o.setName("q5").setDescription("Question 5"))
      .addStringOption((o) => o.setName("q6").setDescription("Question 6"))
      .addStringOption((o) => o.setName("q7").setDescription("Question 7"))
      .addStringOption((o) => o.setName("q8").setDescription("Question 8"))
      .addStringOption((o) => o.setName("q9").setDescription("Question 9"))
      .addStringOption((o) => o.setName("q10").setDescription("Question 10"))
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild!;
  const sub = interaction.options.getSubcommand();
  const type = interaction.options.getString("type") as "staff" | "developer";

  if (sub === "list") {
    const questions = getQuestions(guild.id, type);
    const lines = questions.map((q, i) => `**${i + 1}.** ${q}`).join("\n");
    await interaction.reply({
      content: `**${type === "staff" ? "Staff" : "Developer"} Questions:**\n${lines}`,
      ephemeral: true,
    });
  } else if (sub === "reset") {
    const defaults = getDefaultQuestions(type);
    setQuestions(guild.id, type, defaults);
    await interaction.reply({
      content: `✅ ${type === "staff" ? "Staff" : "Developer"} questions reset to defaults.`,
      ephemeral: true,
    });
  } else if (sub === "set") {
    const newQuestions: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const q = interaction.options.getString(`q${i}`);
      if (q) newQuestions.push(q);
    }
    if (newQuestions.length === 0) {
      await interaction.reply({ content: "❌ You must provide at least one question.", ephemeral: true });
      return;
    }
    setQuestions(guild.id, type, newQuestions);
    await interaction.reply({
      content: `✅ Set ${newQuestions.length} question(s) for **${type}** applications.`,
      ephemeral: true,
    });
  }
}
