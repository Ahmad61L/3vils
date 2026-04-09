import {
  Client,
  Guild,
  GuildMember,
  TextChannel,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageReaction,
  User,
  Message,
  CollectorFilter,
  Collection,
} from "discord.js";
import {
  getGuildConfig,
  getTrackedRoles,
  getQuestions,
  createApplication,
  updateApplication,
  getOpenApplication,
  TrackedRole,
} from "./database.js";
import { refreshEmbed } from "./embed-builder.js";

// ─── Voting threshold rules ─────────────────────────────────────────────────
// Returns how many TOTAL staff reactions are needed before a decision is made.
function getRequiredReactions(totalStaff: number): number {
  if (totalStaff >= 5) return 5;
  if (totalStaff >= 3) return 3;
  return 1;
}

// Count members across ALL tracked roles (including dev role)
function countTotalStaff(guild: Guild, trackedRoles: TrackedRole[]): number {
  let total = 0;
  for (const r of trackedRoles) {
    const role = guild.roles.cache.get(r.role_id);
    if (role) total += role.members.size;
  }
  return total;
}

// Returns true if a user is a member of any tracked role
function isStaffMember(userId: string, guild: Guild, trackedRoles: TrackedRole[]): boolean {
  const gMember = guild.members.cache.get(userId);
  if (!gMember) return false;
  return trackedRoles.some((r) => gMember.roles.cache.has(r.role_id));
}

// Progress bar string
function progressBar(filled: number, total: number): string {
  const chars = 10;
  const filledCount = Math.round((filled / total) * chars);
  return "█".repeat(filledCount) + "░".repeat(chars - filledCount);
}

// ─── Main handler ────────────────────────────────────────────────────────────
export async function handleApplyButton(
  client: Client,
  interaction: import("discord.js").ButtonInteraction,
  type: "staff" | "developer"
) {
  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const config = getGuildConfig(guild.id);

  if (!config) {
    return interaction.reply({ content: "❌ Bot is not configured for this server.", ephemeral: true });
  }
  if (type === "staff" && !config.feature_staff_applications) {
    return interaction.reply({ content: "❌ Staff applications are currently disabled.", ephemeral: true });
  }
  if (type === "developer" && !config.feature_dev_applications) {
    return interaction.reply({ content: "❌ Developer applications are currently disabled.", ephemeral: true });
  }
  if (!config.feature_tickets) {
    return interaction.reply({ content: "❌ Ticket creation is currently disabled.", ephemeral: true });
  }

  // Check for existing open application
  const existing = getOpenApplication(guild.id, member.id);
  if (existing) {
    return interaction.reply({
      content: `❌ You already have an open application. Check <#${existing.channel_id}>.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const trackedRoles = getTrackedRoles(guild.id);
    const totalStaff = countTotalStaff(guild, trackedRoles);
    const requiredReactions = getRequiredReactions(totalStaff);

    // Build permissions for the ticket channel
    const staffPermissions: import("discord.js").OverwriteResolvable[] = [
      { id: guild.id,    deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];
    for (const r of trackedRoles) {
      staffPermissions.push({
        id: r.role_id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AddReactions,
        ],
      });
    }

    // ── Find or create the "Apply" category ─────────────────────────────
    let applyCategoryId: string | null = null;
    const existingCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "apply"
    );
    if (existingCategory) {
      applyCategoryId = existingCategory.id;
    } else {
      try {
        const newCat = await guild.channels.create({
          name: "Apply",
          type: ChannelType.GuildCategory,
        });
        applyCategoryId = newCat.id;
      } catch {
        // Fall back to configured category if we can't create one
        applyCategoryId = config.ticket_category_id ?? null;
      }
    }

    const channelOptions: import("discord.js").GuildChannelCreateOptions = {
      name: `${type}-app-${member.user.username}`.slice(0, 100),
      type: ChannelType.GuildText,
      permissionOverwrites: staffPermissions,
      topic: `Application by ${member.user.tag} | Type: ${type}`,
    };
    if (applyCategoryId) channelOptions.parent = applyCategoryId;

    const channel = (await guild.channels.create(channelOptions)) as TextChannel;
    const appId = createApplication(guild.id, member.id, type, channel.id);

    const questions = getQuestions(guild.id, type);
    const typeLabel = type === "staff" ? "Staff" : "Developer";

    const introEmbed = new EmbedBuilder()
      .setTitle(`${typeLabel} Application — ${member.user.username}`)
      .setDescription(
        `Welcome, <@${member.id}>! Please answer the **${questions.length} questions** below.\n\n` +
        `**Rules:**\n` +
        `• Type your answers as a single message, numbering each one (e.g. \`1. Your answer\`)\n` +
        `• Once you send your answers, **this channel locks** and staff will review\n\n` +
        `⚠️ Make sure your answers are complete before sending.`
      )
      .setColor(type === "staff" ? 0x5865f2 : 0x57f287)
      .setFooter({ text: "Host: q7evn." });

    await channel.send({ embeds: [introEmbed] });
    await channel.send(questions.map((q, i) => `**${i + 1}.** ${q}`).join("\n\n"));

    await interaction.editReply({
      content: `✅ Your application ticket has been created! Head to <#${channel.id}>.`,
    });

    // Wait for applicant's single answer message
    const msgFilter: CollectorFilter<[Message]> = (m: Message) =>
      m.author.id === member.id && !m.author.bot;

    const msgCollector = channel.createMessageCollector({
      filter: msgFilter,
      max: 1,
      time: 86_400_000, // 24 hours
    });

    msgCollector.on("collect", async (msg: Message) => {
      updateApplication(appId, { answers: msg.content });

      // Lock channel for applicant
      await channel.permissionOverwrites.edit(member.id, { SendMessages: false });

      // ── Build review embed ──────────────────────────────────────────────
      const buildReviewEmbed = (checkCount: number, crossCount: number) => {
        const total = checkCount + crossCount;
        const bar = progressBar(total, requiredReactions);
        return new EmbedBuilder()
          .setTitle(`📋 ${typeLabel} Application — Under Review`)
          .setDescription(
            `**Applicant:** <@${member.id}>\n\n` +
            `**Answers:**\n${msg.content.slice(0, 900)}${msg.content.length > 900 ? "..." : ""}\n\n` +
            `──────────────────────\n` +
            `**Staff:** React with ✅ to approve or ❌ to reject.\n\n` +
            `**Voting progress:** \`${bar}\` ${total}/${requiredReactions}\n` +
            `✅ ${checkCount}  ❌ ${crossCount}\n\n` +
            `*Requires ${requiredReactions} staff reactions (${totalStaff} staff on team). ` +
            `Decision: majority wins, at least 1 ✅ needed to approve.*`
          )
          .setColor(0xfee75c)
          .setFooter({ text: "Host: q7evn." });
      };

      const reviewMsg = await channel.send({ embeds: [buildReviewEmbed(0, 0)] });
      await reviewMsg.react("✅");
      await reviewMsg.react("❌");

      // ── Helpers ─────────────────────────────────────────────────────────
      const isAdminOrOwner = (userId: string): boolean => {
        if (guild.ownerId === userId) return true;
        const m = guild.members.cache.get(userId);
        return !!m?.permissions.has(PermissionFlagsBits.Administrator);
      };

      // ── Reaction collector ───────────────────────────────────────────────
      // Allow staff members AND admins/owner to react
      const reactionFilter = (reaction: MessageReaction, user: User): boolean => {
        if (user.bot) return false;
        if (!["✅", "❌"].includes(reaction.emoji.name ?? "")) return false;
        return isStaffMember(user.id, guild, trackedRoles) || isAdminOrOwner(user.id);
      };

      const reactionCollector = reviewMsg.createReactionCollector({
        filter: reactionFilter,
        time: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      const countStaffReactions = async () => {
        const checkR = reviewMsg.reactions.cache.get("✅");
        const crossR = reviewMsg.reactions.cache.get("❌");

        const checkUsrs = checkR ? await checkR.users.fetch() : new Collection<string, User>();
        const crossUsrs = crossR ? await crossR.users.fetch() : new Collection<string, User>();

        const staffCheck = [...checkUsrs.values()].filter(
          (u) => !u.bot && (isStaffMember(u.id, guild, trackedRoles) || isAdminOrOwner(u.id))
        ).length;
        const staffCross = [...crossUsrs.values()].filter(
          (u) => !u.bot && (isStaffMember(u.id, guild, trackedRoles) || isAdminOrOwner(u.id))
        ).length;

        return { staffCheck, staffCross };
      };

      // Shared finalize function to avoid duplication
      const finalizeDecision = async (
        approved: boolean,
        staffCheck: number,
        staffCross: number,
        decidedBy: string,
        instant: boolean
      ) => {
        reactionCollector.stop("decided");

        const status = approved ? "approved" : "rejected";
        updateApplication(appId, {
          status,
          decided_at: Math.floor(Date.now() / 1000),
          decided_by: decidedBy,
        });

        // Auto-role the applicant on approval
        if (approved) {
          try {
            const targetRoleId = type === "staff"
              ? trackedRoles.find((r) => r.is_lowest_role)?.role_id
              : trackedRoles.find((r) => r.is_dev_role)?.role_id;

            if (targetRoleId) {
              const freshMember = await guild.members.fetch(member.id).catch(() => null);
              if (freshMember) await freshMember.roles.add(targetRoleId);
            }
          } catch (err) {
            console.error("Failed to auto-role approved applicant:", err);
          }
        }

        const instantNote = instant
          ? `\n\n⚡ *Instantly decided by <@${decidedBy}> (Admin/Owner)*`
          : `\n\n**Final vote:** ✅ ${staffCheck}  ❌ ${staffCross} out of ${requiredReactions} required`;

        const resultEmbed = new EmbedBuilder()
          .setTitle(approved ? "✅ Application Approved" : "❌ Application Rejected")
          .setDescription(
            approved
              ? `<@${member.id}>'s application has been **approved**! They have been given the ${typeLabel} role automatically.${instantNote}`
              : `<@${member.id}>'s application has been **rejected**.${instantNote}`
          )
          .setColor(approved ? 0x57f287 : 0xed4245)
          .setFooter({ text: "Host: q7evn." });

        await channel.send({ embeds: [resultEmbed] });

        // DM the applicant
        try {
          await member.send(
            approved
              ? `Congratulations 🎉 Welcome to the team I hope for good cooperation`
              : `❌ Your **${typeLabel}** application in **${guild.name}** was **rejected**. You may reapply in the future.`
          );
        } catch {}

        // Log to log channel
        if (config.log_channel_id) {
          const logChannel = guild.channels.cache.get(config.log_channel_id);
          if (logChannel?.isTextBased()) await logChannel.send({ embeds: [resultEmbed] });
        }

        // Auto-close: notify then delete the ticket channel after 5 seconds
        await channel.send("🔒 This ticket will be closed automatically in 5 seconds...").catch(() => {});
        await refreshEmbed(client, guild.id);
        setTimeout(() => {
          channel.delete("Application ticket auto-closed after decision").catch(() => {});
        }, 5_000);
      };

      reactionCollector.on("collect", async (reaction: MessageReaction, user: User) => {
        // ── Admin / Owner instant approval ───────────────────────────────
        if (isAdminOrOwner(user.id) && reaction.emoji.name === "✅") {
          await finalizeDecision(true, 1, 0, user.id, true);
          return;
        }

        // ── Normal staff vote ────────────────────────────────────────────
        const { staffCheck, staffCross } = await countStaffReactions();
        const totalVotes = staffCheck + staffCross;

        // Update progress bar on the review message
        try {
          await reviewMsg.edit({ embeds: [buildReviewEmbed(staffCheck, staffCross)] });
        } catch {}

        // Check if vote threshold is met
        if (totalVotes < requiredReactions) return;

        // Threshold met — make the decision based on vote majority
        const approved = staffCheck > staffCross && staffCheck >= 1;
        await finalizeDecision(approved, staffCheck, staffCross, "staff_vote", false);
      });

      reactionCollector.on("end", async (_collected, reason) => {
        if (reason === "decided" || reason === "threshold_met") return; // Already handled
        // Timed out with no decision
        await channel.send("⏰ This application has expired with no decision. Closing ticket in 5 seconds...").catch(() => {});
        updateApplication(appId, { status: "rejected" });
        setTimeout(() => {
          channel.delete("Application ticket expired — no decision reached").catch(() => {});
        }, 5_000);
      });
    });

    msgCollector.on("end", async (collected) => {
      if (collected.size === 0) {
        await channel.send("⏰ Application timed out (no answers submitted). Closing ticket.").catch(() => {});
        updateApplication(appId, { status: "rejected" });
        setTimeout(() => channel.delete().catch(() => {}), 10_000);
      }
    });
  } catch (err) {
    console.error("Error creating ticket:", err);
    await interaction.editReply({ content: "❌ Failed to create ticket. Please contact an admin." });
  }
}
