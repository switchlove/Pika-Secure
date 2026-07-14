import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';

const ENV_KEYS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DATABASE_PATH'];
const ENV_PATH = '../../src/config/env.js';
const VALID_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccccccccc';
const VALID_CLIENT_ID = '123456789012345678';
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
    process.env.DISCORD_CLIENT_ID = VALID_CLIENT_ID;
    await expect(import(ENV_PATH)).rejects.toThrow(/DISCORD_TOKEN/);
  });

  it('throws when DISCORD_CLIENT_ID is missing', async () => {
    process.env.DISCORD_TOKEN = VALID_TOKEN;
    await expect(import(ENV_PATH)).rejects.toThrow(/DISCORD_CLIENT_ID/);
  });

  it('throws when DISCORD_TOKEN does not look like a bot token', async () => {
    process.env.DISCORD_TOKEN = 'not-a-real-token';
    process.env.DISCORD_CLIENT_ID = VALID_CLIENT_ID;
    await expect(import(ENV_PATH)).rejects.toThrow(/DISCORD_TOKEN does not look like/);
  });

  it('throws when DISCORD_CLIENT_ID is not a numeric snowflake', async () => {
    process.env.DISCORD_TOKEN = VALID_TOKEN;
    process.env.DISCORD_CLIENT_ID = 'not-a-snowflake';
    await expect(import(ENV_PATH)).rejects.toThrow(/DISCORD_CLIENT_ID does not look like/);
  });

  it('loads config when required vars are present', async () => {
    process.env.DISCORD_TOKEN = VALID_TOKEN;
    process.env.DISCORD_CLIENT_ID = VALID_CLIENT_ID;
    const config = (await import(ENV_PATH)).default;
    expect(config.token).toBe(VALID_TOKEN);
    expect(config.clientId).toBe(VALID_CLIENT_ID);
    expect(config.devGuildId).toBeNull();
    expect(config.databasePath).toMatch(/pikasecure\.sqlite$/);
  });

  it('uses DISCORD_GUILD_ID when provided', async () => {
    process.env.DISCORD_TOKEN = VALID_TOKEN;
    process.env.DISCORD_CLIENT_ID = VALID_CLIENT_ID;
    process.env.DISCORD_GUILD_ID = 'guild-id';
    const config = (await import(ENV_PATH)).default;
    expect(config.devGuildId).toBe('guild-id');
  });

  it('resolves a custom DATABASE_PATH', async () => {
    process.env.DISCORD_TOKEN = VALID_TOKEN;
    process.env.DISCORD_CLIENT_ID = VALID_CLIENT_ID;
    process.env.DATABASE_PATH = './custom/path.sqlite';
    const config = (await import(ENV_PATH)).default;
    expect(config.databasePath).toMatch(/custom[\\/]path\.sqlite$/);
  });
});
