const path = require('node:path');
require('dotenv').config();

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key} (see .env.example)`);
  }
}

// Bot tokens are three dot-separated base64url segments and client IDs are numeric Discord
// snowflakes. Checking the shape here means a truncated copy-paste or leftover placeholder value
// fails fast at boot with a clear message, instead of only surfacing later as an opaque error
// from client.login().
const TOKEN_SHAPE_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;
if (!TOKEN_SHAPE_PATTERN.test(process.env.DISCORD_TOKEN)) {
  throw new Error(
    'DISCORD_TOKEN does not look like a valid Discord bot token (expected three dot-separated segments) — check .env for a truncated or placeholder value',
  );
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
if (!SNOWFLAKE_PATTERN.test(process.env.DISCORD_CLIENT_ID)) {
  throw new Error(
    'DISCORD_CLIENT_ID does not look like a valid Discord snowflake ID (expected 17-20 digits) — check .env for a placeholder value',
  );
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  devGuildId: process.env.DISCORD_GUILD_ID || null,
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/pikasecure.sqlite'),
};
