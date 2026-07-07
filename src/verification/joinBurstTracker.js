const joinsByGuild = new Map();

/**
 * Records a join for the guild and returns how many joins have happened
 * within the trailing windowSeconds, including this one.
 */
function recordJoin(guildId, windowSeconds) {
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;

  const timestamps = (joinsByGuild.get(guildId) || []).filter((t) => t > cutoff);
  timestamps.push(now);
  joinsByGuild.set(guildId, timestamps);

  return timestamps.length;
}

module.exports = { recordJoin };
