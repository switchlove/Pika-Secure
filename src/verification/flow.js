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
} = require('../database/pendingVerifications');
const { insertAuditLog } = require('../database/auditLog');
const { computeRiskScore } = require('./riskAssessment');
const { recordJoin } = require('./joinBurstTracker');
const { recordAvatar } = require('./avatarTracker');
const { assignUnverifiedRole, applyVerifiedRoles } = require('./quarantine');
const { generateImageCaptcha, pickDifficulty, normalizeAnswer } = require('./captcha');
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

async function handleMemberJoin(member) {
  const guildConfig = getGuildConfig(member.guild.id);

  if (!guildConfig.unverified_role_id || !guildConfig.verification_channel_id) {
    logger.warn(`Guild ${member.guild.id}: ${member.id} joined but PikaSecure is not configured.`);
    await modlog.send(member.client, guildConfig, embeds.unconfiguredEmbed(member));
    return;
  }

  const burstCount = recordJoin(member.guild.id, guildConfig.join_burst_window_seconds);
  const avatarReuseCount = recordAvatar(member.guild.id, member.user.avatar, guildConfig.avatar_reuse_window_seconds);
  const { score, reasons } = computeRiskScore(member, guildConfig, burstCount, avatarReuseCount);
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
  await applyVerifiedRoles(member, guildConfig);
  markVerified(member.guild.id, member.id);
  insertAuditLog(member.guild.id, member.id, 'verified', { viaCaptcha, latencyMs, fastSolve });
  await modlog.send(member.client, guildConfig, embeds.verifiedEmbed(member, viaCaptcha, latencyMs, fastSolve));
  await welcome.send(member.client, guildConfig, member);
}

function buildCaptchaPayload(buffer, title, description) {
  const attachment = new AttachmentBuilder(buffer, { name: 'captcha.png' });
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(title)
    .setDescription(description)
    .setImage('attachment://captcha.png');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('captcha:openmodal').setLabel('Enter Code').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], files: [attachment], components: [row], flags: MessageFlags.Ephemeral };
}

async function presentCaptcha(interaction, guildConfig, riskScore) {
  const difficulty = pickDifficulty(riskScore, guildConfig.hard_captcha_risk_threshold);
  const { answer, buffer } = generateImageCaptcha(difficulty);
  escalateToCaptcha(interaction.guild.id, interaction.user.id, answer);
  insertAuditLog(interaction.guild.id, interaction.user.id, 'captcha_escalated');
  await modlog.send(interaction.client, guildConfig, embeds.captchaEscalatedEmbed(interaction.member));

  const payload = buildCaptchaPayload(
    buffer,
    'Solve the captcha to continue',
    'Click **Enter Code** and type the text shown below.',
  );
  return interaction.reply(payload);
}

async function handleVerifyButtonClick(interaction) {
  const guildConfig = getGuildConfig(interaction.guild.id);
  const record = getPendingVerification(interaction.guild.id, interaction.user.id);

  if (!record) {
    return interaction.reply({
      content: 'There is nothing to verify — try rejoining the server.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (record.state === 'verified') {
    return interaction.reply({ content: 'You are already verified.', flags: MessageFlags.Ephemeral });
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
    return interaction.reply({ content: 'You have been verified. Welcome!', flags: MessageFlags.Ephemeral });
  }

  if (record.state === 'captcha' && Date.now() - record.updated_at < MIN_RECAPTCHA_MS) {
    return interaction.reply({
      content: 'You already have an active captcha — click **Enter Code** above, or wait a moment before requesting a new one.',
      flags: MessageFlags.Ephemeral,
    });
  }

  return presentCaptcha(interaction, guildConfig, record.risk_score);
}

async function handleCaptchaModalOpen(interaction) {
  const record = getPendingVerification(interaction.guild.id, interaction.user.id);
  if (!record || record.state !== 'captcha') {
    return interaction.reply({
      content: 'No active captcha to solve — click Verify again.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder().setCustomId('captcha:submit').setTitle('Enter the captcha code');
  const input = new TextInputBuilder()
    .setCustomId('captcha:answer')
    .setLabel('Code shown in the image')
    .setStyle(TextInputStyle.Short)
    .setMinLength(record.captcha_answer.length)
    .setMaxLength(record.captcha_answer.length)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
}

async function handleCaptchaModalSubmit(interaction) {
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
    await verifyMember(interaction.member, guildConfig, true, latencyMs);
    return interaction.reply({ content: 'Correct! You have been verified. Welcome!', flags: MessageFlags.Ephemeral });
  }

  const attempts = record.captcha_attempts + 1;
  const flagged = attempts >= guildConfig.max_captcha_attempts;
  const difficulty = pickDifficulty(record.risk_score, guildConfig.hard_captcha_risk_threshold);
  const nextAnswer = flagged ? null : generateImageCaptcha(difficulty);

  recordCaptchaFailure(interaction.guild.id, interaction.user.id, nextAnswer ? nextAnswer.answer : null, flagged);
  insertAuditLog(
    interaction.guild.id,
    interaction.user.id,
    flagged ? 'captcha_max_failed' : 'captcha_failed',
    { attempts },
  );
  await modlog.send(
    interaction.client,
    guildConfig,
    embeds.captchaFailedEmbed(interaction.member, attempts, guildConfig.max_captcha_attempts, flagged),
  );

  if (flagged) {
    return interaction.reply({
      content: 'Incorrect — too many failed attempts. A moderator has been notified to review your case.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const payload = buildCaptchaPayload(
    nextAnswer.buffer,
    'Incorrect — try again',
    `Attempt ${attempts}/${guildConfig.max_captcha_attempts}. A new code has been generated.`,
  );
  return interaction.reply(payload);
}

module.exports = {
  handleMemberJoin,
  handleVerifyButtonClick,
  handleCaptchaModalOpen,
  handleCaptchaModalSubmit,
};
