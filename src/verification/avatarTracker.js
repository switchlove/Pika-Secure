const { hammingDistance } = require('./avatarHash');
const {
  insertEvent,
  countExactValueInWindow,
  getRecentValuesInWindow,
} = require('../database/raidSignalEvents');

const EXACT_KIND = 'avatar_exact';
const PERCEPTUAL_KIND = 'avatar_perceptual';

// Hamming distance is cheap per pair, but still run against every prior row in the window —
// bounding how many rows we compare against keeps one join's cost bounded even during a huge
// raid burst. See usernameTracker.js for the same reasoning (it also does O(n) comparisons).
const MAX_COMPARISONS = 200;

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

  insertEvent(guildId, EXACT_KIND, avatarHash, now);
  return countExactValueInWindow(guildId, EXACT_KIND, avatarHash, cutoff);
}

/**
 * Records a member's perceptual (dHash) avatar hash for the guild and
 * returns how many recent avatars — including this one — are near-duplicates
 * (Hamming distance <= hammingThreshold). Unlike recordAvatar, this catches
 * resized/recompressed/lightly-edited copies of the same image, not just
 * byte-identical files.
 */
function recordPerceptualHash(guildId, perceptualHash, windowSeconds, hammingThreshold) {
  if (!perceptualHash) return 0;

  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;

  const priorRows = getRecentValuesInWindow(guildId, PERCEPTUAL_KIND, cutoff, MAX_COMPARISONS);
  const nearDuplicateCount = priorRows.filter(
    (row) => hammingDistance(row.value, perceptualHash) <= hammingThreshold,
  ).length;

  insertEvent(guildId, PERCEPTUAL_KIND, perceptualHash, now);
  return nearDuplicateCount + 1;
}

module.exports = { recordAvatar, recordPerceptualHash };
