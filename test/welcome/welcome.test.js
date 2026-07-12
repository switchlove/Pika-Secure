import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let logger;
let welcome;

beforeEach(() => {
  bustSrcRequireCache(require);
  logger = require('../../src/utils/logger.js');
  logger.warn = vi.fn();
  welcome = require('../../src/welcome/welcome.js');
});

function makeClient(fetchImpl) {
  return { channels: { fetch: vi.fn(fetchImpl) } };
}

function makeChannel({ isTextBased = true, sendResolves = true } = {}) {
  return {
    isTextBased: () => isTextBased,
    send: sendResolves
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('send failed')),
  };
}

describe('welcome.renderMessage', () => {
  it('falls back to the default message when no template is set', () => {
    expect(welcome.renderMessage(undefined, { id: '123' })).toBe('Welcome <@123>! 🎉');
    expect(welcome.renderMessage(null, { id: '123' })).toBe('Welcome <@123>! 🎉');
  });

  it('substitutes {user} in a custom template', () => {
    expect(welcome.renderMessage('gm {user} 👋', { id: '456' })).toBe('gm <@456> 👋');
  });

  it('substitutes every occurrence of {user}', () => {
    expect(welcome.renderMessage('{user} {user}', { id: '789' })).toBe('<@789> <@789>');
  });
});

describe('welcome.send', () => {
  it('no-ops when welcome_channel_id is not configured', async () => {
    const client = makeClient();
    await welcome.send(client, {}, { id: '1' });
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('sends the rendered message when the channel is text-based', async () => {
    const channel = makeChannel();
    const client = makeClient(() => Promise.resolve(channel));

    await welcome.send(client, { welcome_channel_id: 'chan-1' }, { id: 'user-1' });

    expect(client.channels.fetch).toHaveBeenCalledWith('chan-1');
    expect(channel.send).toHaveBeenCalledWith({
      content: 'Welcome <@user-1>! 🎉',
      allowedMentions: { parse: ['users'] },
    });
  });

  it('restricts allowed mentions to users, preventing an admin-set template from pinging @everyone/roles', async () => {
    const channel = makeChannel();
    const client = makeClient(() => Promise.resolve(channel));

    await welcome.send(
      client,
      { welcome_channel_id: 'chan-1', welcome_message: '@everyone welcome {user}!' },
      { id: 'user-1' },
    );

    expect(channel.send).toHaveBeenCalledWith({
      content: '@everyone welcome <@user-1>!',
      allowedMentions: { parse: ['users'] },
    });
  });

  it('uses a configured custom message template', async () => {
    const channel = makeChannel();
    const client = makeClient(() => Promise.resolve(channel));

    await welcome.send(
      client,
      { welcome_channel_id: 'chan-1', welcome_message: 'hey {user}!' },
      { id: 'user-1' },
    );

    expect(channel.send).toHaveBeenCalledWith({
      content: 'hey <@user-1>!',
      allowedMentions: { parse: ['users'] },
    });
  });

  it('does not send when the channel is not text-based', async () => {
    const channel = makeChannel({ isTextBased: false });
    const client = makeClient(() => Promise.resolve(channel));

    await welcome.send(client, { welcome_channel_id: 'chan-1' }, { id: 'user-1' });

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('does not throw when the channel fetch resolves to null/undefined', async () => {
    const client = makeClient(() => Promise.resolve(null));
    await expect(
      welcome.send(client, { welcome_channel_id: 'chan-1' }, { id: 'user-1' }),
    ).resolves.toBeUndefined();
  });

  it('swallows a rejected channel fetch and logs a warning', async () => {
    const client = makeClient(() => Promise.reject(new Error('no access')));

    await expect(
      welcome.send(client, { welcome_channel_id: 'chan-1' }, { id: 'user-1' }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Failed to send welcome message:', 'no access');
  });

  it('swallows a rejected channel.send and logs a warning', async () => {
    const channel = makeChannel({ sendResolves: false });
    const client = makeClient(() => Promise.resolve(channel));

    await expect(
      welcome.send(client, { welcome_channel_id: 'chan-1' }, { id: 'user-1' }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Failed to send welcome message:', 'send failed');
  });
});
