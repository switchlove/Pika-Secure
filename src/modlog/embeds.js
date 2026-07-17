const { EmbedBuilder } = require('discord.js');

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

function userField(member) {
  return `<@${member.id}> (\`${member.user.tag}\`, \`${member.id}\`)`;
}

function joinedEmbed(member, score, reasons) {
  return baseEmbed(0xfee75c)
    .setTitle('Member joined — quarantined')
    .setDescription(userField(member))
    .addFields(
      { name: 'Risk score', value: `${score}/100` },
      { name: 'Reasons', value: reasons.map((r) => `• ${r}`).join('\n') },
    );
}

function verifiedEmbed(member, viaCaptcha, latencyMs = null, fastSolve = false) {
  const embed = baseEmbed(0x57f287)
    .setTitle('Verification succeeded')
    .setDescription(userField(member))
    .addFields({ name: 'Method', value: viaCaptcha ? 'Captcha' : 'Button (low risk)' });

  if (fastSolve) {
    embed.addFields({
      name: '⚠️ Unusually fast solve',
      value: `Solved in ${latencyMs}ms — possible automation, worth a second look.`,
    });
  }

  return embed;
}

function captchaEscalatedEmbed(member) {
  return baseEmbed(0xe67e22)
    .setTitle('Captcha escalated')
    .setDescription(`${userField(member)} was risky enough to require a captcha.`);
}

function captchaFailedEmbed(member, attempts, maxAttempts, flagged) {
  return baseEmbed(flagged ? 0xed4245 : 0xe67e22)
    .setTitle(flagged ? 'Captcha failed — flagged for review' : 'Captcha attempt failed')
    .setDescription(userField(member))
    .addFields({ name: 'Attempts', value: `${attempts}/${maxAttempts}` });
}

function fastSolveFlaggedEmbed(member, latencyMs, repeatCount) {
  return baseEmbed(0xed4245)
    .setTitle('Captcha solved correctly — flagged for review')
    .setDescription(userField(member))
    .addFields(
      { name: 'Solve time', value: `${latencyMs}ms` },
      { name: 'Fast solves in window', value: `${repeatCount}` },
    );
}

function autoKickedEmbed(guildId, userId) {
  return baseEmbed(0xed4245)
    .setTitle('Auto-kick performed')
    .setDescription(
      `<@${userId}> (\`${userId}\`) did not verify before the deadline and was kicked.`,
    );
}

function honeypotTriggeredEmbed(member, trigger = 'message', banFailed = false) {
  const action =
    trigger === 'reaction'
      ? 'reacted to the bait message in the honeypot channel'
      : 'posted in the honeypot channel';

  if (banFailed) {
    return baseEmbed(0xff0000)
      .setTitle('⚠️ Honeypot triggered — ban FAILED, manual action needed')
      .setDescription(
        `${userField(member)} ${action}. The bot could not ban this member — check its **Ban Members** permission and role position, then ban manually.`,
      );
  }

  return baseEmbed(0xed4245)
    .setTitle('Honeypot triggered — banned')
    .setDescription(`${userField(member)} ${action} and was banned.`);
}

function flaggedListEmbed(records) {
  const embed = baseEmbed(0xed4245).setTitle('Flagged for review');
  if (records.length === 0) {
    embed.setDescription('No members currently flagged.');
    return embed;
  }

  embed.addFields(
    records.slice(0, 20).map((r) => ({
      name: `<@${r.user_id}> (${r.user_id})`,
      value: `Score: ${r.risk_score}/100 · Attempts: ${r.captcha_attempts}\n${(
        JSON.parse(r.risk_reasons || '[]').join(', ') || 'No reasons recorded'
      ).slice(0, 200)}`,
    })),
  );
  return embed;
}

function auditLogListEmbed(entries) {
  const embed = baseEmbed(0x5865f2).setTitle('Recent audit log');
  if (entries.length === 0) {
    embed.setDescription('No matching audit log entries.');
    return embed;
  }

  embed.addFields(
    entries.slice(0, 20).map((e) => ({
      name: `${e.event_type} — <t:${Math.floor(e.created_at / 1000)}:R>`,
      value: `${e.user_id ? `<@${e.user_id}>` : 'N/A'}\n${(e.detail || '(no detail)').slice(0, 200)}`,
    })),
  );
  return embed;
}

function raidLockdownEngagedEmbed(burstCount, levelRaised) {
  const embed = baseEmbed(0xff0000)
    .setTitle('🚨 Raid lockdown engaged')
    .setDescription(
      `${burstCount} joins in a short window crossed the raid lockdown threshold — this is on top of, not instead of, per-member risk scoring and captcha escalation.`,
    );

  embed.addFields({
    name: levelRaised ? 'Server verification level raised' : "⚠️ Couldn't raise verification level",
    value: levelRaised
      ? 'Temporarily raised — will revert automatically once the lockdown window elapses.'
      : "Check the bot's **Manage Server** permission; the lockdown alert still fired, but the server's own verification level was left unchanged.",
  });

  return embed;
}

function raidLockdownLiftedEmbed(reverted) {
  const embed = baseEmbed(0x57f287).setTitle('✅ Raid lockdown lifted');

  embed.setDescription(
    reverted
      ? 'The lockdown window elapsed — verification level was reverted to what it was before.'
      : '⚠️ The lockdown window elapsed, but reverting the verification level failed — check it manually.',
  );

  return embed;
}

function unconfiguredEmbed(member) {
  return baseEmbed(0xed4245)
    .setTitle('PikaSecure is not configured')
    .setDescription(
      `${userField(member)} joined but no unverified role / verification channel is set. Run \`/setup\`.`,
    );
}

module.exports = {
  joinedEmbed,
  verifiedEmbed,
  captchaEscalatedEmbed,
  captchaFailedEmbed,
  fastSolveFlaggedEmbed,
  flaggedListEmbed,
  auditLogListEmbed,
  autoKickedEmbed,
  honeypotTriggeredEmbed,
  raidLockdownEngagedEmbed,
  raidLockdownLiftedEmbed,
  unconfiguredEmbed,
};
