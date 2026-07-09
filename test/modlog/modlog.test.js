import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let logger;
let modlog;

beforeEach(() => {
  bustSrcRequireCache(require);
  logger = injectFakeModule(require, '../../src/utils/logger.js', { warn: vi.fn(), error: vi.fn(), info: vi.fn() });
  modlog = require('../../src/modlog/modlog.js');
});

function makeClient(fetchImpl) {
  return { channels: { fetch: vi.fn(fetchImpl) } };
}

function makeChannel({ isTextBased = true, sendResolves = true } = {}) {
  return {
    isTextBased: () => isTextBased,
    send: sendResolves ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('send failed')),
  };
}

describe('modlog.send', () => {
  it('no-ops when mod_log_channel_id is not configured', async () => {
    const client = makeClient();
    await modlog.send(client, {}, { title: 'x' });
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('sends the embed when the channel is text-based', async () => {
    const channel = makeChannel();
    const client = makeClient(() => Promise.resolve(channel));
    const embed = { title: 'hello' };

    await modlog.send(client, { mod_log_channel_id: 'chan-1' }, embed);

    expect(client.channels.fetch).toHaveBeenCalledWith('chan-1');
    expect(channel.send).toHaveBeenCalledWith({ embeds: [embed] });
  });

  it('does not send when the channel is not text-based', async () => {
    const channel = makeChannel({ isTextBased: false });
    const client = makeClient(() => Promise.resolve(channel));

    await modlog.send(client, { mod_log_channel_id: 'chan-1' }, {});

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('does not throw when the channel fetch resolves to null/undefined', async () => {
    const client = makeClient(() => Promise.resolve(null));
    await expect(modlog.send(client, { mod_log_channel_id: 'chan-1' }, {})).resolves.toBeUndefined();
  });

  it('swallows a rejected channel fetch and logs a warning', async () => {
    const client = makeClient(() => Promise.reject(new Error('no access')));

    await expect(modlog.send(client, { mod_log_channel_id: 'chan-1' }, {})).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Failed to send mod-log message:', 'no access');
  });

  it('swallows a rejected channel.send and logs a warning', async () => {
    const channel = makeChannel({ sendResolves: false });
    const client = makeClient(() => Promise.resolve(channel));

    await expect(modlog.send(client, { mod_log_channel_id: 'chan-1' }, {})).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Failed to send mod-log message:', 'send failed');
  });
});
