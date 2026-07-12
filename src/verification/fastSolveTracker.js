const { insertEvent, countInWindow } = require('../database/raidSignalEvents');

const KIND = 'fast_solve';

/**
 * Records a captcha solve that came in faster than a human-plausible floor
 * and returns how many such fast solves this guild has seen within the
 * trailing windowSeconds, including this one. A single fast solve is common
 * for genuinely quick typists; a cluster within the window is more likely a
 * captcha-solving service hitting the guild repeatedly.
 */
function recordFastSolve(guildId, windowSeconds) {
  const now = Date.now();
  insertEvent(guildId, KIND, null, now);
  return countInWindow(guildId, KIND, now - windowSeconds * 1000);
}

module.exports = { recordFastSolve };
