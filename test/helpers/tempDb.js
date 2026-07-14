import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export { bustSrcRequireCache } from './moduleCache.js';

const ENV_KEYS = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DATABASE_PATH'];

let originalEnv = null;

export function setupTempDb() {
  originalEnv = { ...process.env };
  const dbPath = path.join(
    os.tmpdir(),
    `pika-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  // Shaped to pass env.js's token/snowflake format validation (three dot-separated segments /
  // 17-20 digits) — these are not real credentials.
  process.env.DISCORD_TOKEN = 'test-token-aaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccc';
  process.env.DISCORD_CLIENT_ID = '123456789012345678';
  process.env.DATABASE_PATH = dbPath;
  delete process.env.DISCORD_GUILD_ID;
  return dbPath;
}

export function teardownTempDb(dbPath) {
  for (const key of ENV_KEYS) delete process.env[key];
  if (originalEnv) Object.assign(process.env, originalEnv);
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {
      // Best-effort: a lingering Windows file lock shouldn't fail the test.
    }
  }
}
