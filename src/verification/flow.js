const {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const { getGuildConfig } = require('../database/guildConfig');
const {
  createPendingVerification,
  getPendingVerification,
  markVerified,
  escalateToCaptcha,
  recordCaptchaFailure,
  bumpRiskScore,
  flagPendingVerification,
} = require('../database/pendingVerifications');
const { insertAuditLog } = require('../database/auditLog');
const { computeRiskScore, FAST_SOLVE_RISK_POINTS } = require('./riskAssessment');
const { recordJoin } = require('./joinBurstTracker');
const { recordAvatar, recordPerceptualHash } = require('./avatarTracker');
const { computeAvatarHash } = require('./avatarHash');
const { recordUsername } = require('./usernameTracker');
const { recordFastSolve } = require('./fastSolveTracker');
const raidLockdown = require('./raidLockdown');
const { assignUnverifiedRole, applyVerifiedRoles } = require('./quarantine');
const {
  generateChallenge,
  pickCaptchaType,
  pickDifficulty,
  normalizeAnswer,
} = require('./captcha');
const modlog = require('../modlog/modlog');
const embeds = require('../modlog/embeds');
const welcome = require('../welcome/welcome');
const logger = require('../utils/logger');

// A code solved faster than this after being shown is unlikely to be a human
// reading and typing it — flag it for mod visibility without blocking a
// correct answer (avoids punishing genuinely fast typists).
const MIN_HUMAN_SOLVE_MS = 1200;
// Cheap guard against a script hammering the modal submit in a tight loop.
const MIN_RESUBMIT_MS = 1000;
// Cheap guard against hammering the Verify button itself to keep cycling fresh
// captchas (and spamming the modlog) instead of solving the one already shown.
const MIN_RECAPTCHA_MS = 5000;

// Guards handleVerifyButtonClick/handleCaptchaModalSubmit against a double-click or a fast
// resubmit racing the same member's verification through two overlapping invocations before the
// first has written its state change (getPendingVerification is a stale read until then) — both
// would otherwise pass the same state check and duplicate a role grant, welcome message, or
// audit-log entry. Single-process, in-memory lock is sufficient since the bot is one process.
const inFlightVerifications = new Set();

function verificationLockKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function withVerificationLock(interaction, handler) {
  const key = verificationLockKey(interaction.guild.id, interaction.user.id);
  if (inFlightVerifications.has(key)) {
    return interaction.reply({
      content: 'Still processing your previous request — please wait a moment.',
      flags: MessageFlags.Ephemeral,
    });
  }
  inFlightVerifications.add(key);
  try {
    return await handler();
  } finally {
    inFlightVerifications.delete(key);
  }
}

// Best-effort perceptual-hash lookup: never lets a slow/failed CDN fetch
// block or delay the join-gate — falls back to "no signal" on any error.
async function getPerceptualAvatarMatchCount(member, guildConfig) {
  if (!member.user.avatar) return 0;

  try {
    const avatarURL = member.user.avatarURL({ extension: 'png', size: 64 });
    if (!avatarURL) return 0;

    const hash = await computeAvatarHash(avatarURL);
    return recordPerceptualHash(
      member.guild.id,
      hash,
      guildConfig.avatar_reuse_window_seconds,
      guildConfig.perceptual_avatar_hamming_threshold,
    );
  } catch (err) {
    logger.warn(
      `Failed to compute perceptual avatar hash for ${member.id} in guild ${member.guild.id}:`,
      err.message,
    );
    return 0;
  }
}

async function handleMemberJoin(member) {
  const guildConfig = getGuildConfig(member.guild.id);

  if (!guildConfig.unverified_role_id || !guildConfig.verification_channel_id) {
    // Deliberately logger.error (not warn): this member joined completely ungated, which is a
    // security-relevant gap, not routine chatter — and modlog.send below is a no-op if the
    // mod-log channel also isn't configured yet (typically true mid-setup), so this console line
    // may be the only visible signal that joins are currently passing through unquarantined.
    logger.error(`Guild ${member.guild.id}: ${member.id} joined but PikaSecure is not configured.`);
    await modlog.send(member.client, guildConfig, embeds.unconfiguredEmbed(member));
    return;
  }

  const burstCount = recordJoin(member.guild.id, guildConfig.join_burst_window_seconds);
  try {
    await raidLockdown.maybeEngage(member.guild, guildConfig, burstCount);
  } catch (err) {
    logger.error(`Failed to evaluate raid lockdown for guild ${member.guild.id}:`, err.message);
  }

  const avatarReuseCount = recordAvatar(
    member.guild.id,
    member.user.avatar,
    guildConfig.avatar_reuse_window_seconds,
  );
  const perceptualAvatarMatchCount = await getPerceptualAvatarMatchCount(member, guildConfig);
  const similarUsernameCount = recordUsername(
    member.guild.id,
    member.user.username,
    guildConfig.username_similarity_window_seconds,
    guildConfig.username_similarity_distance_threshold,
  );
  const { score, reasons } = computeRiskScore(
    member,
    guildConfig,
    burstCount,
    avatarReuseCount,
    perceptualAvatarMatchCount,
    similarUsernameCount,
  );
  const deadlineAt = Date.now() + guildConfig.verification_timeout_min * 60_000;

  createPendingVerification({
    guildId: member.guild.id,
    userId: member.id,
    riskScore: score,
    riskReasons: reasons,
    deadlineAt,
    joinedAt: Date.now(),
  });

  try {
    await assignUnverifiedRole(member, guildConfig);
  } catch (err) {
    logger.error(`Failed to assign unverified role in guild ${member.guild.id}:`, err.message);
  }

  insertAuditLog(member.guild.id, member.id, 'joined', { score, reasons });
  await modlog.send(member.client, guildConfig, embeds.joinedEmbed(member, score, reasons));
}

async function verifyMember(member, guildConfig, viaCaptcha, latencyMs = null) {
  const fastSolve = latencyMs !== null && latencyMs < MIN_HUMAN_SOLVE_MS;
  if (fastSolve) {
    bumpRiskScore(member.guild.id, member.id, FAST_SOLVE_RISK_POINTS, [
      `Captcha solved in ${latencyMs}ms (< ${MIN_HUMAN_SOLVE_MS}ms human-solve floor) — +${FAST_SOLVE_RISK_POINTS}`,
    ]);
  }
  await applyVerifiedRoles(member, guildConfig);
  markVerified(member.guild.id, member.id);
  insertAuditLog(member.guild.id, member.id, 'verified', { viaCaptcha, latencyMs, fastSolve });
  await modlog.send(
    member.client,
    guildConfig,
    embeds.verifiedEmbed(member, viaCaptcha, latencyMs, fastSolve),
  );
  await welcome.send(member.client, guildConfig, member);
}

function buildCaptchaPayload(challenge, title, description) {
  const embed = new EmbedBuilder().setColor(0xe67e22).setTitle(title);
  const files = [];

  if (challenge.type === 'math') {
    embed.setDescription(`${description}\n\n**${challenge.prompt}**`);
  } else {
    files.push(new AttachmentBuilder(challenge.buffer, { name: 'captcha.png' }));
    embed.setDescription(description).setImage('attachment://captcha.png');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('captcha:openmodal')
      .setLabel('Enter Code')
      .setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], files, components: [row], flags: MessageFlags.Ephemeral };
}

async function presentCaptcha(interaction, guildConfig, riskScore) {
  const difficulty = pickDifficulty(riskScore, guildConfig.hard_captcha_risk_threshold);
  const type = pickCaptchaType(guildConfig.captcha_type, difficulty);
  const challenge = generateChallenge(type, difficulty);
  escalateToCaptcha(interaction.guild.id, interaction.user.id, challenge.answer, challenge.type);
  insertAuditLog(interaction.guild.id, interaction.user.id, 'captcha_escalated', {
    type: challenge.type,
    difficulty,
  });
  await modlog.send(
    interaction.client,
    guildConfig,
    embeds.captchaEscalatedEmbed(interaction.member),
  );

  const payload = buildCaptchaPayload(
    challenge,
    'Solve the captcha to continue',
    challenge.type === 'math'
      ? 'Click **Enter Code** and answer the question below.'
      : 'Click **Enter Code** and type the text shown below.',
  );
  return interaction.reply(payload);
}

async function handleVerifyButtonClick(interaction) {
  return withVerificationLock(interaction, async () => {
    const guildConfig = getGuildConfig(interaction.guild.id);
    const record = getPendingVerification(interaction.guild.id, interaction.user.id);

    if (!record) {
      return interaction.reply({
        content: 'There is nothing to verify — try rejoining the server.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (record.state === 'verified') {
      return interaction.reply({
        content: 'You are already verified.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (record.state === 'kicked') {
      return interaction.reply({
        content: 'Your verification window expired. Please contact a moderator.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (record.state === 'flagged') {
      return interaction.reply({
        content: 'Too many failed attempts — a moderator has been notified to review your case.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (record.state === 'pending' && record.risk_score < guildConfig.captcha_risk_threshold) {
      await verifyMember(interaction.member, guildConfig, false);
      return interaction.reply({
        content: 'You have been verified. Welcome!',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (record.state === 'captcha' && Date.now() - record.updated_at < MIN_RECAPTCHA_MS) {
      return interaction.reply({
        content:
          'You already have an active captcha — click **Enter Code** above, or wait a moment before requesting a new one.',
        flags: MessageFlags.Ephemeral,
      });
    }

    return presentCaptcha(interaction, guildConfig, record.risk_score);
  });
}

async function handleCaptchaModalOpen(interaction) {
  const record = getPendingVerification(interaction.guild.id, interaction.user.id);
  if (!record || record.state !== 'captcha') {
    return interaction.reply({
      content: 'No active captcha to solve — click Verify again.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const isMath = record.captcha_type === 'math';
  const modal = new ModalBuilder().setCustomId('captcha:submit').setTitle('Enter the captcha code');
  const input = new TextInputBuilder()
    .setCustomId('captcha:answer')
    .setLabel(isMath ? 'Your answer' : 'Code shown in the image')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (isMath) {
    input.setMinLength(1).setMaxLength(10);
  } else {
    input.setMinLength(record.captcha_answer.length).setMaxLength(record.captcha_answer.length);
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
}

async function handleCaptchaModalSubmit(interaction) {
  return withVerificationLock(interaction, async () => {
    const guildConfig = getGuildConfig(interaction.guild.id);
    const record = getPendingVerification(interaction.guild.id, interaction.user.id);

    if (!record || record.state !== 'captcha') {
      return interaction.reply({
        content: 'No active captcha to solve — click Verify again.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const latencyMs = Date.now() - record.updated_at;
    if (latencyMs < MIN_RESUBMIT_MS) {
      return interaction.reply({
        content: 'Please wait a moment before trying again.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const submitted = normalizeAnswer(interaction.fields.getTextInputValue('captcha:answer'));
    if (submitted === record.captcha_answer) {
      const fastSolve = latencyMs < MIN_HUMAN_SOLVE_MS;
      const repeatFastSolveCount = fastSolve
        ? recordFastSolve(interaction.guild.id, guildConfig.fast_solve_window_seconds)
        : 0;

      if (repeatFastSolveCount > guildConfig.fast_solve_count_threshold) {
        flagPendingVerification(interaction.guild.id, interaction.user.id);
        insertAuditLog(interaction.guild.id, interaction.user.id, 'captcha_fast_solve_flagged', {
          latencyMs,
          repeatFastSolveCount,
        });
        await modlog.send(
          interaction.client,
          guildConfig,
          embeds.fastSolveFlaggedEmbed(interaction.member, latencyMs, repeatFastSolveCount),
        );
        return interaction.reply({
          content:
            'Correct — but this verification pattern needs manual review. A moderator has been notified.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await verifyMember(interaction.member, guildConfig, true, latencyMs);
      return interaction.reply({
        content: 'Correct! You have been verified. Welcome!',
        flags: MessageFlags.Ephemeral,
      });
    }

    const attempts = record.captcha_attempts + 1;
    const flagged = attempts >= guildConfig.max_captcha_attempts;
    const difficulty = pickDifficulty(record.risk_score, guildConfig.hard_captcha_risk_threshold);
    const nextType = flagged ? null : pickCaptchaType(guildConfig.captcha_type, difficulty);
    const nextChallenge = flagged ? null : generateChallenge(nextType, difficulty);

    recordCaptchaFailure(
      interaction.guild.id,
      interaction.user.id,
      nextChallenge ? nextChallenge.answer : null,
      flagged,
      nextChallenge ? nextChallenge.type : null,
    );
    insertAuditLog(
      interaction.guild.id,
      interaction.user.id,
      flagged ? 'captcha_max_failed' : 'captcha_failed',
      { attempts },
    );
    await modlog.send(
      interaction.client,
      guildConfig,
      embeds.captchaFailedEmbed(
        interaction.member,
        attempts,
        guildConfig.max_captcha_attempts,
        flagged,
      ),
    );

    if (flagged) {
      return interaction.reply({
        content:
          'Incorrect — too many failed attempts. A moderator has been notified to review your case.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const payload = buildCaptchaPayload(
      nextChallenge,
      'Incorrect — try again',
      `Attempt ${attempts}/${guildConfig.max_captcha_attempts}. A new code has been generated.`,
    );
    return interaction.reply(payload);
  });
}

module.exports = {
  handleMemberJoin,
  handleVerifyButtonClick,
  handleCaptchaModalOpen,
  handleCaptchaModalSubmit,
};
