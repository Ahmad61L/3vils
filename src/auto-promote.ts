import { Client, Guild } from "discord.js";
import {
  getTrackedRoles,
  getGuildConfig,
  logPromotion,
  db,
} from "./database.js";
import { refreshEmbed } from "./embed-builder.js";

// Thresholds for auto-promotion
const AUTO_PROMOTE_MIN_DAYS = 7;
const AUTO_PROMOTE_MIN_AVG_SECONDS = 3600; // 1h/day average
const AUTO_PROMOTE_MIN_MESSAGES = 100;

export async function checkAutoPromote(client: Client, guild: Guild) {
  const config = getGuildConfig(guild.id);
  if (!config || !config.feature_auto_promote) return;

  const trackedRoles = getTrackedRoles(guild.id);
  if (trackedRoles.length < 2) return;

  // Sort by role_order ascending (lowest first)
  const sorted = [...trackedRoles].sort((a, b) => a.role_order - b.role_order);

  // For each role tier, check members and see if they qualify for next tier
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentRole = sorted[i];
    const nextRole = sorted[i + 1];
    if (nextRole.is_dev_role) continue; // Don't auto-promote to dev role

    const role = guild.roles.cache.get(currentRole.role_id);
    if (!role) continue;

    await guild.members.fetch();

    for (const [, member] of role.members) {
      // Already has next role?
      if (member.roles.cache.has(nextRole.role_id)) continue;

      // Check activity over last 7 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - AUTO_PROMOTE_MIN_DAYS);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const stats = db
        .prepare(
          `SELECT 
            COUNT(*) as days_active,
            AVG(active_seconds) as avg_seconds,
            SUM(message_count) as total_messages
           FROM member_activity 
           WHERE guild_id = ? AND user_id = ? AND date >= ?`
        )
        .get(guild.id, member.id, cutoffStr) as {
        days_active: number;
        avg_seconds: number;
        total_messages: number;
      };

      if (
        stats.days_active >= AUTO_PROMOTE_MIN_DAYS &&
        stats.avg_seconds >= AUTO_PROMOTE_MIN_AVG_SECONDS &&
        stats.total_messages >= AUTO_PROMOTE_MIN_MESSAGES
      ) {
        try {
          await member.roles.add(nextRole.role_id);
          logPromotion(
            guild.id,
            member.id,
            currentRole.role_id,
            nextRole.role_id,
            `Auto-promoted: ${stats.days_active} active days, avg ${Math.round(stats.avg_seconds / 60)}m/day, ${stats.total_messages} messages`
          );

          // Log to log channel if configured
          if (config.log_channel_id) {
            const logChannel = guild.channels.cache.get(config.log_channel_id);
            if (logChannel?.isTextBased()) {
              await logChannel.send(
                `🎉 **Auto-Promotion** — <@${member.id}> was promoted to <@&${nextRole.role_id}> based on ${AUTO_PROMOTE_MIN_DAYS} days of high activity (avg ${Math.round(stats.avg_seconds / 60)}min/day, ${stats.total_messages} messages).`
              );
            }
          }

          await refreshEmbed(client, guild.id);
        } catch (err) {
          console.error(`Failed to auto-promote ${member.id}:`, err);
        }
      }
    }
  }
}
