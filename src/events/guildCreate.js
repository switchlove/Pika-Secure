const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../database/guildConfig');
const logger = require('../utils/logger');

const BOT_ROLE_COLOR = 0xf6cf57;

const SETUP_REMINDER_MESSAGE =
  "👋 Thanks for adding PikaSecure! New members aren't gated yet — until `/setup` is completed " +
  '(at minimum `/setup roles` and `/setup channels`), joins pass through unquarantined. ' +
  'Anyone with the **Manage Server** permission can run `/setup` to get started.';

async function setBotRoleColor(guild, me) {
  const botRole = me.roles.botRole;
  if (!botRole) return;
  await botRole.setColor(BOT_ROLE_COLOR);
}

// Unconfigured guilds fail open at join-time (see flow.js's handleMemberJoin) — this is a
// one-time nudge, posted when the bot is first added, so an admin who never finishes `/setup`
// gets a visible signal in-server rather than joins silently passing through ungated.
async function postSetupReminder(guild, me) {
  const guildConfig = getGuildConfig(guild.id);
  if (guildConfig.unverified_role_id && guildConfig.verification_channel_id) return;

  const channel = guild.systemChannel;
  if (!channel) return;
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return;

  await channel.send(SETUP_REMINDER_MESSAGE);
}

module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    let me;
    try {
      me = guild.members.me ?? (await guild.members.fetchMe());
    } catch (err) {
      logger.error(`Failed to resolve bot member in guild ${guild.id}:`, err.message);
      return;
    }

    try {
      await setBotRoleColor(guild, me);
    } catch (err) {
      logger.error(`Failed to set bot role color in guild ${guild.id}:`, err.message);
    }

    try {
      await postSetupReminder(guild, me);
    } catch (err) {
      logger.error(`Failed to post setup reminder in guild ${guild.id}:`, err.message);
    }
  },
};
