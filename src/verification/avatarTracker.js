const avatarsByGuild = new Map();

/**
 * Records a member's avatar hash for the guild and returns how many times
 * that exact hash has been seen within the trailing windowSeconds, including
 * this one. Null/undefined hashes (no custom avatar) are not tracked here —
 * that case is already covered by the no-avatar risk signal.
 */
function recordAvatar(guildId, avatarHash, windowSeconds) {
  if (!avatarHash) return 0;

  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;

  const guildMap = avatarsByGuild.get(guildId) || new Map();
  const timestamps = (guildMap.get(avatarHash) || []).filter((t) => t > cutoff);
  timestamps.push(now);
  guildMap.set(avatarHash, timestamps);
  avatarsByGuild.set(guildId, guildMap);

  return timestamps.length;
}

module.exports = { recordAvatar };
