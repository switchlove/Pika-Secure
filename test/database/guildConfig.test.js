import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setupTempDb, teardownTempDb, bustSrcRequireCache } from '../helpers/tempDb.js';

const require = createRequire(import.meta.url);

let dbPath;
let db;
let getGuildConfig;
let updateGuildConfig;

beforeEach(() => {
  dbPath = setupTempDb();
  bustSrcRequireCache(require);
  db = require('../../src/database/db.js');
  ({ getGuildConfig, updateGuildConfig } = require('../../src/database/guildConfig.js'));
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  teardownTempDb(dbPath);
});

describe('getGuildConfig', () => {
  it('bootstraps a default row for a new guild id', () => {
    const config = getGuildConfig('guild-new');
    expect(config.guild_id).toBe('guild-new');
    expect(config.unverified_role_id).toBeNull();
    expect(config.verification_timeout_min).toBe(15);
    expect(config.admin_role_ids).toEqual([]);
  });

  it('is idempotent — calling twice does not reset created_at', () => {
    const first = getGuildConfig('guild-twice');
    const second = getGuildConfig('guild-twice');
    expect(second.created_at).toBe(first.created_at);
  });

  it('round-trips a non-empty admin_role_ids array through JSON', () => {
    updateGuildConfig('guild-admins', { admin_role_ids: ['r1', 'r2'] });
    const config = getGuildConfig('guild-admins');
    expect(config.admin_role_ids).toEqual(['r1', 'r2']);
  });
});

describe('updateGuildConfig', () => {
  it('only persists whitelisted fields', () => {
    const updated = updateGuildConfig('guild-wl', {
      unverified_role_id: 'role-u',
      guild_id: 'should-be-ignored',
      foo: 'not-a-real-field',
    });
    expect(updated.unverified_role_id).toBe('role-u');
    expect(updated.guild_id).toBe('guild-wl');
  });

  it('no-ops (never builds an UPDATE) when every field is undefined', () => {
    getGuildConfig('guild-noop');
    const before = getGuildConfig('guild-noop');
    const after = updateGuildConfig('guild-noop', {
      unverified_role_id: undefined,
      foo: undefined,
    });
    expect(after).toEqual(before);
  });

  it('applies a multi-field update and bumps updated_at', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    getGuildConfig('guild-multi');

    vi.setSystemTime(2_000_000);
    const updated = updateGuildConfig('guild-multi', {
      verification_channel_id: 'chan-1',
      mod_log_channel_id: 'chan-2',
      verification_timeout_min: 30,
    });

    expect(updated.verification_channel_id).toBe('chan-1');
    expect(updated.mod_log_channel_id).toBe('chan-2');
    expect(updated.verification_timeout_min).toBe(30);
    expect(updated.updated_at).toBe(2_000_000);
    expect(updated.created_at).toBe(1_000_000);
  });

  it('ensures the guild row exists even if update is called before any get', () => {
    const updated = updateGuildConfig('guild-fresh', { min_account_age_days: 3 });
    expect(updated.min_account_age_days).toBe(3);
  });

  it('persists the welcome channel and message fields', () => {
    const updated = updateGuildConfig('guild-welcome', {
      welcome_channel_id: 'chan-welcome',
      welcome_message: 'hey {user}!',
    });
    expect(updated.welcome_channel_id).toBe('chan-welcome');
    expect(updated.welcome_message).toBe('hey {user}!');
  });

  it('defaults and persists the fast-solve threshold fields', () => {
    const defaults = getGuildConfig('guild-fastsolve-defaults');
    expect(defaults.fast_solve_count_threshold).toBe(3);
    expect(defaults.fast_solve_window_seconds).toBe(300);

    const updated = updateGuildConfig('guild-fastsolve-defaults', {
      fast_solve_count_threshold: 5,
      fast_solve_window_seconds: 120,
    });
    expect(updated.fast_solve_count_threshold).toBe(5);
    expect(updated.fast_solve_window_seconds).toBe(120);
  });

  it('defaults captcha_type to "image" and persists an updated value', () => {
    const defaults = getGuildConfig('guild-captcha-type-defaults');
    expect(defaults.captcha_type).toBe('image');

    const updated = updateGuildConfig('guild-captcha-type-defaults', { captcha_type: 'math' });
    expect(updated.captcha_type).toBe('math');
  });
});
