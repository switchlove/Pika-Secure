const { insertEvent, countInWindow } = require('../database/raidSignalEvents');

const KIND = 'join';

/**
 * Records a join for the guild and returns how many joins have happened
 * within the trailing windowSeconds, including this one.
 */
function recordJoin(guildId, windowSeconds) {
  const now = Date.now();
  insertEvent(guildId, KIND, null, now);
  return countInWindow(guildId, KIND, now - windowSeconds * 1000);
}

module.exports = { recordJoin };
