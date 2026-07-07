const path = require('node:path');
require('dotenv').config();

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key} (see .env.example)`);
  }
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  devGuildId: process.env.DISCORD_GUILD_ID || null,
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/pikasecure.sqlite'),
};
