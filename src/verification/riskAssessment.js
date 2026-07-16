const DAY_MS = 24 * 60 * 60 * 1000;

const ACCOUNT_AGE_MAX_POINTS = 40;
const NO_AVATAR_POINTS = 25;
const JOIN_BURST_POINTS = 35;
const DUPLICATE_AVATAR_POINTS = 30;
const SUSPICIOUS_USERNAME_POINTS = 15;
const TRUSTED_BADGE_DISCOUNT = 20;
const PERCEPTUAL_AVATAR_MATCH_POINTS = 20;
const SIMILAR_USERNAME_CLUSTER_POINTS = 20;
// Applied post-hoc (after captcha, not at join-time) when a solve comes in
// faster than a human-plausible floor — see flow.js's verifyMember.
const FAST_SOLVE_RISK_POINTS = 20;

// Heuristic only: matches common auto-generated bot username shapes like
// "user48213" (a word followed by 4+ trailing digits). Imperfect by design —
// it's one signal among several, not a hard gate.
const SUSPICIOUS_USERNAME_PATTERN = /^[a-z]+\d{4,}$/i;

// Public flags/badges that require real account history and are hard for a
// throwaway account to fake.
const TRUSTED_BADGE_FLAGS = [
  'Staff',
  'Partner',
  'Hypesquad',
  'HypeSquadOnlineHouse1',
  'HypeSquadOnlineHouse2',
  'HypeSquadOnlineHouse3',
  'BugHunterLevel1',
  'BugHunterLevel2',
  'VerifiedDeveloper',
  'ActiveDeveloper',
  'PremiumEarlySupporter',
];

// Flat add-if-applicable risk factors, evaluated in this order after the account-age check (which
// is a variable-points formula, not a flat add) and before the trusted-badge discount (which
// subtracts rather than adds) — those two stay hand-written below since they don't fit this shape.
const FLAT_RISK_FACTORS = [
  {
    points: NO_AVATAR_POINTS,
    applies: (member) => !member.user.avatar,
    reason: () => `No custom avatar — +${NO_AVATAR_POINTS}`,
  },
  {
    points: JOIN_BURST_POINTS,
    applies: (member, guildConfig, ctx) => ctx.burstCount > guildConfig.join_burst_count_threshold,
    reason: (member, guildConfig, ctx) =>
      `Part of a join burst (${ctx.burstCount} joins within ${guildConfig.join_burst_window_seconds}s) — +${JOIN_BURST_POINTS}`,
  },
  {
    points: DUPLICATE_AVATAR_POINTS,
    applies: (member, guildConfig, ctx) =>
      Boolean(member.user.avatar) &&
      ctx.avatarReuseCount > guildConfig.avatar_reuse_count_threshold,
    reason: (member, guildConfig, ctx) =>
      `Avatar reused by ${ctx.avatarReuseCount} recent joins within ${guildConfig.avatar_reuse_window_seconds}s — +${DUPLICATE_AVATAR_POINTS}`,
  },
  {
    points: PERCEPTUAL_AVATAR_MATCH_POINTS,
    applies: (member, guildConfig, ctx) =>
      Boolean(member.user.avatar) &&
      ctx.perceptualAvatarMatchCount > guildConfig.avatar_reuse_count_threshold,
    reason: (member, guildConfig, ctx) =>
      `Avatar closely resembles ${ctx.perceptualAvatarMatchCount} recent joins within ${guildConfig.avatar_reuse_window_seconds}s — +${PERCEPTUAL_AVATAR_MATCH_POINTS}`,
  },
  {
    points: SUSPICIOUS_USERNAME_POINTS,
    applies: (member) => SUSPICIOUS_USERNAME_PATTERN.test(member.user.username),
    reason: () =>
      `Username matches a common bot-generated pattern — +${SUSPICIOUS_USERNAME_POINTS}`,
  },
  {
    points: SIMILAR_USERNAME_CLUSTER_POINTS,
    applies: (member, guildConfig, ctx) =>
      ctx.similarUsernameCount > guildConfig.username_similarity_count_threshold,
    reason: (member, guildConfig, ctx) =>
      `Username is similar to ${ctx.similarUsernameCount} recent joins within ${guildConfig.username_similarity_window_seconds}s — +${SIMILAR_USERNAME_CLUSTER_POINTS}`,
  },
];

function computeRiskScore(
  member,
  guildConfig,
  burstCount,
  avatarReuseCount = 0,
  perceptualAvatarMatchCount = 0,
  similarUsernameCount = 0,
) {
  const reasons = [];
  let score = 0;
  const ctx = { burstCount, avatarReuseCount, perceptualAvatarMatchCount, similarUsernameCount };

  const accountAgeDays = (Date.now() - member.user.createdTimestamp) / DAY_MS;
  const minAccountAgeDays = guildConfig.min_account_age_days;
  if (accountAgeDays < minAccountAgeDays) {
    const points = Math.round(
      ACCOUNT_AGE_MAX_POINTS * Math.min(1, 1 - accountAgeDays / minAccountAgeDays),
    );
    score += points;
    reasons.push(
      `Account is ${accountAgeDays.toFixed(1)} days old (threshold: ${minAccountAgeDays}d) — +${points}`,
    );
  }

  for (const factor of FLAT_RISK_FACTORS) {
    if (factor.applies(member, guildConfig, ctx)) {
      score += factor.points;
      reasons.push(factor.reason(member, guildConfig, ctx));
    }
  }

  const badges = member.user.flags?.toArray() ?? [];
  const trustedBadges = badges.filter((flag) => TRUSTED_BADGE_FLAGS.includes(flag));
  if (trustedBadges.length > 0) {
    score -= TRUSTED_BADGE_DISCOUNT;
    reasons.push(
      `Account has trusted public badge(s) (${trustedBadges.join(', ')}) — -${TRUSTED_BADGE_DISCOUNT}`,
    );
  }

  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) reasons.push('No risk factors detected');

  return { score, reasons };
}

module.exports = { computeRiskScore, FAST_SOLVE_RISK_POINTS };
