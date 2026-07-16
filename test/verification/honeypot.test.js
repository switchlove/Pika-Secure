import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { PermissionFlagsBits } from 'discord.js';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let auditLog;
let modlog;
let embeds;
let logger;
let honeypot;

const HONEYPOT_TRIGGERED_EMBED = { sentinel: 'honeypot-triggered' };

beforeEach(() => {
  bustSrcRequireCache(require);
  auditLog = injectFakeModule(require, '../../src/database/auditLog.js', {
    insertAuditLog: vi.fn(),
  });
  modlog = injectFakeModule(require, '../../src/modlog/modlog.js', {
    send: vi.fn().mockResolvedValue(undefined),
  });
  embeds = injectFakeModule(require, '../../src/modlog/embeds.js', {
    honeypotTriggeredEmbed: vi.fn().mockReturnValue(HONEYPOT_TRIGGERED_EMBED),
  });
  logger = injectFakeModule(require, '../../src/utils/logger.js', {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  });
  honeypot = require('../../src/verification/honeypot.js');
});

function makeMember({ banResolves = true } = {}) {
  return {
    id: 'user-1',
    guild: { id: 'guild-1' },
    user: { tag: 'user#0001' },
    ban: banResolves
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('missing perms')),
  };
}

describe('STAFF_EXEMPT_PERMISSIONS', () => {
  it('exempts the four staff-level permission flags', () => {
    expect(honeypot.STAFF_EXEMPT_PERMISSIONS).toEqual([
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.KickMembers,
    ]);
  });
});

describe('isHoneypotChannel', () => {
  it('returns false when no honeypot channel is configured', () => {
    expect(honeypot.isHoneypotChannel({}, 'chan-1')).toBe(false);
  });

  it('returns false when the channel does not match', () => {
    expect(honeypot.isHoneypotChannel({ honeypot_channel_id: 'chan-1' }, 'chan-2')).toBe(false);
  });

  it('returns true when the channel matches the configured honeypot channel', () => {
    expect(honeypot.isHoneypotChannel({ honeypot_channel_id: 'chan-1' }, 'chan-1')).toBe(true);
  });
});

describe('isStaffExempt', () => {
  it('returns false when the member has none of the exempt permissions', () => {
    const member = { permissions: { has: vi.fn().mockReturnValue(false) } };
    expect(honeypot.isStaffExempt(member)).toBe(false);
  });

  it('returns true when the member has at least one exempt permission', () => {
    const member = {
      permissions: {
        has: vi.fn((flag) => flag === PermissionFlagsBits.BanMembers),
      },
    };
    expect(honeypot.isStaffExempt(member)).toBe(true);
  });
});

describe('triggerHoneypot', () => {
  it('bans the member, logs the audit event, and notifies modlog on success', async () => {
    const member = makeMember();
    const guildConfig = { mod_log_channel_id: 'chan-1' };
    const client = {};
    const meta = { channelId: 'honeypot-1', trigger: 'message' };

    await honeypot.triggerHoneypot(member, guildConfig, client, meta);

    expect(member.ban).toHaveBeenCalledWith({ reason: 'Triggered honeypot channel (message)' });
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'honeypot_triggered',
      meta,
    );
    expect(embeds.honeypotTriggeredEmbed).toHaveBeenCalledWith(member, 'message');
    expect(modlog.send).toHaveBeenCalledWith(client, guildConfig, HONEYPOT_TRIGGERED_EMBED);
  });

  it('swallows a rejected ban and logs a warning without throwing', async () => {
    const member = makeMember({ banResolves: false });

    await expect(
      honeypot.triggerHoneypot(member, {}, {}, { channelId: 'honeypot-1', trigger: 'reaction' }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(auditLog.insertAuditLog).not.toHaveBeenCalled();
    expect(modlog.send).not.toHaveBeenCalled();
  });
});
