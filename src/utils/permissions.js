const { PermissionFlagsBits } = require('discord.js');

function isTrueAdmin(member) {
  return member.permissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function canManageBot(member, guildConfig) {
  if (isTrueAdmin(member)) return true;
  const adminRoleIds = guildConfig?.admin_role_ids ?? [];
  return (
    adminRoleIds.length > 0 && member.roles.cache.some((role) => adminRoleIds.includes(role.id))
  );
}

module.exports = { isTrueAdmin, canManageBot };
