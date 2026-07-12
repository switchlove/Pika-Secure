const { MessageFlags } = require('discord.js');
const flow = require('../verification/flow');
const logger = require('../utils/logger');

async function replyError(interaction) {
  const payload = {
    content: 'Something went wrong handling that. Please try again.',
    flags: MessageFlags.Ephemeral,
  };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // Interaction may have already expired; nothing more we can do.
  }
}

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId === 'verify:start') {
          await flow.handleVerifyButtonClick(interaction);
        } else if (interaction.customId === 'captcha:openmodal') {
          await flow.handleCaptchaModalOpen(interaction);
        }
        return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'captcha:submit') {
          await flow.handleCaptchaModalSubmit(interaction);
        }
        return;
      }
    } catch (err) {
      logger.error('Error handling interaction:', err);
      await replyError(interaction);
    }
  },
};
