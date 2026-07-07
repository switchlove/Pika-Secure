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

function autoKickedEmbed(guildId, userId) {
  return baseEmbed(0xed4245)
    .setTitle('Auto-kick performed')
    .setDescription(`<@${userId}> (\`${userId}\`) did not verify before the deadline and was kicked.`);
}

function honeypotTriggeredEmbed(member, trigger = 'message') {
  const action = trigger === 'reaction' ? 'reacted to the bait message in the honeypot channel' : 'posted in the honeypot channel';
  return baseEmbed(0xed4245)
    .setTitle('Honeypot triggered — banned')
    .setDescription(`${userField(member)} ${action} and was banned.`);
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
  autoKickedEmbed,
  honeypotTriggeredEmbed,
  unconfiguredEmbed,
};
