import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';

const ENV_KEYS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DATABASE_PATH'];
const ENV_PATH = '../../src/config/env.js';
let originalEnv;
let originalCwd;

beforeEach(() => {
  originalEnv = { ...process.env };
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
  // dotenv.config() reads ".env" relative to process.cwd(). The real repo
  // .env has real secrets, which would otherwise refill the vars this suite
  // deletes above — running from a directory with no .env avoids that.
  originalCwd = process.cwd();
  process.chdir(os.tmpdir());
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, originalEnv);
  vi.resetModules();
});

describe('env config', () => {
  it('throws when DISCORD_TOKEN is missing', async () => {
    process.env.DISCORD_CLIENT_ID = 'client-id';
    await expect(import(ENV_PATH)).rejects.toThrow(/DISCORD_TOKEN/);
  });

  it('throws when DISCORD_CLIENT_ID is missing', async () => {
    process.env.DISCORD_TOKEN = 'token';
    await expect(import(ENV_PATH)).rejects.toThrow(/DISCORD_CLIENT_ID/);
  });

  it('loads config when required vars are present', async () => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_CLIENT_ID = 'client-id';
    const config = (await import(ENV_PATH)).default;
    expect(config.token).toBe('token');
    expect(config.clientId).toBe('client-id');
    expect(config.devGuildId).toBeNull();
    expect(config.databasePath).toMatch(/pikasecure\.sqlite$/);
  });

  it('uses DISCORD_GUILD_ID when provided', async () => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.DISCORD_GUILD_ID = 'guild-id';
    const config = (await import(ENV_PATH)).default;
    expect(config.devGuildId).toBe('guild-id');
  });

  it('resolves a custom DATABASE_PATH', async () => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.DATABASE_PATH = './custom/path.sqlite';
    const config = (await import(ENV_PATH)).default;
    expect(config.databasePath).toMatch(/custom[\\/]path\.sqlite$/);
  });
});
