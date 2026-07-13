const { insertEvent, getRecentValuesInWindow } = require('../database/raidSignalEvents');

const KIND = 'username';

// Levenshtein distance is O(n*m) per pair, run against every prior row in the window — bounding
// how many rows we compare against keeps one join's cost bounded even during a huge raid burst,
// rather than degrading toward O(n^2) across the whole burst.
const MAX_COMPARISONS = 200;

/** Lowercases and strips non-alphanumerics/trailing digits so that names like
 * "Raider_01" and "raider02" normalize to the same base string. */
function normalizeUsername(username) {
  return String(username || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\d+$/, '');
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[rows - 1][cols - 1];
}

/**
 * Records a member's (normalized) username for the guild and returns how
 * many recent usernames — including this one — are similar (Levenshtein
 * distance <= distanceThreshold after normalization). Catches coordinated
 * raids using varied-but-similar names (e.g. "xX_raider_01", "xX_raider_02"),
 * which the single bot-pattern regex in riskAssessment.js misses.
 */
function recordUsername(guildId, username, windowSeconds, distanceThreshold) {
  const normalized = normalizeUsername(username);
  if (!normalized) return 0;

  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;

  const priorRows = getRecentValuesInWindow(guildId, KIND, cutoff, MAX_COMPARISONS);
  const similarCount = priorRows.filter(
    (row) => levenshteinDistance(row.value, normalized) <= distanceThreshold,
  ).length;

  insertEvent(guildId, KIND, normalized, now);
  return similarCount + 1;
}

module.exports = { normalizeUsername, levenshteinDistance, recordUsername };
