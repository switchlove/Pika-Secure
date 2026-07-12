import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { MessageFlags } from 'discord.js';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let flow;
let logger;
let interactionCreate;

beforeEach(() => {
  bustSrcRequireCache(require);
  flow = injectFakeModule(require, '../../src/verification/flow.js', {
    handleVerifyButtonClick: vi.fn(),
    handleCaptchaModalOpen: vi.fn(),
    handleCaptchaModalSubmit: vi.fn(),
  });
  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  interactionCreate = require('../../src/events/interactionCreate.js');
});

function makeInteraction(overrides = {}) {
  return {
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    customId: undefined,
    commandName: undefined,
    client: { commands: { get: vi.fn() } },
    deferred: false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('interactionCreate.execute', () => {
  describe('chat input commands', () => {
    it('runs the matched command', async () => {
      const command = { execute: vi.fn().mockResolvedValue(undefined) };
      const interaction = makeInteraction({ isChatInputCommand: () => true, commandName: 'setup' });
      interaction.client.commands.get.mockReturnValue(command);

      await interactionCreate.execute(interaction);

      expect(interaction.client.commands.get).toHaveBeenCalledWith('setup');
      expect(command.execute).toHaveBeenCalledWith(interaction);
    });

    it('silently no-ops when the command is not found', async () => {
      const interaction = makeInteraction({
        isChatInputCommand: () => true,
        commandName: 'unknown',
      });
      interaction.client.commands.get.mockReturnValue(undefined);

      await expect(interactionCreate.execute(interaction)).resolves.toBeUndefined();
    });
  });

  describe('button interactions', () => {
    it('routes verify:start to handleVerifyButtonClick', async () => {
      const interaction = makeInteraction({ isButton: () => true, customId: 'verify:start' });
      await interactionCreate.execute(interaction);
      expect(flow.handleVerifyButtonClick).toHaveBeenCalledWith(interaction);
    });

    it('routes captcha:openmodal to handleCaptchaModalOpen', async () => {
      const interaction = makeInteraction({ isButton: () => true, customId: 'captcha:openmodal' });
      await interactionCreate.execute(interaction);
      expect(flow.handleCaptchaModalOpen).toHaveBeenCalledWith(interaction);
    });

    it('ignores an unrecognized button customId', async () => {
      const interaction = makeInteraction({ isButton: () => true, customId: 'something:else' });
      await interactionCreate.execute(interaction);
      expect(flow.handleVerifyButtonClick).not.toHaveBeenCalled();
      expect(flow.handleCaptchaModalOpen).not.toHaveBeenCalled();
    });
  });

  describe('modal submit interactions', () => {
    it('routes captcha:submit to handleCaptchaModalSubmit', async () => {
      const interaction = makeInteraction({
        isModalSubmit: () => true,
        customId: 'captcha:submit',
      });
      await interactionCreate.execute(interaction);
      expect(flow.handleCaptchaModalSubmit).toHaveBeenCalledWith(interaction);
    });

    it('ignores an unrecognized modal customId', async () => {
      const interaction = makeInteraction({
        isModalSubmit: () => true,
        customId: 'something:else',
      });
      await interactionCreate.execute(interaction);
      expect(flow.handleCaptchaModalSubmit).not.toHaveBeenCalled();
    });
  });

  it('does nothing when none of the interaction-type predicates match', async () => {
    const interaction = makeInteraction();
    await expect(interactionCreate.execute(interaction)).resolves.toBeUndefined();
  });

  describe('error handling', () => {
    it('logs the error and replies when not yet replied/deferred', async () => {
      const interaction = makeInteraction({ isButton: () => true, customId: 'verify:start' });
      flow.handleVerifyButtonClick.mockRejectedValue(new Error('flow blew up'));

      await interactionCreate.execute(interaction);

      expect(logger.error).toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Something went wrong handling that. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
      expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it('uses followUp when the interaction was already deferred', async () => {
      const interaction = makeInteraction({
        isButton: () => true,
        customId: 'verify:start',
        deferred: true,
      });
      flow.handleVerifyButtonClick.mockRejectedValue(new Error('flow blew up'));

      await interactionCreate.execute(interaction);

      expect(interaction.followUp).toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('uses followUp when the interaction was already replied', async () => {
      const interaction = makeInteraction({
        isButton: () => true,
        customId: 'verify:start',
        replied: true,
      });
      flow.handleVerifyButtonClick.mockRejectedValue(new Error('flow blew up'));

      await interactionCreate.execute(interaction);

      expect(interaction.followUp).toHaveBeenCalled();
    });

    it('swallows a further error from reply/followUp itself', async () => {
      const interaction = makeInteraction({ isButton: () => true, customId: 'verify:start' });
      flow.handleVerifyButtonClick.mockRejectedValue(new Error('flow blew up'));
      interaction.reply.mockRejectedValue(new Error('interaction expired'));

      await expect(interactionCreate.execute(interaction)).resolves.toBeUndefined();
    });
  });
});
