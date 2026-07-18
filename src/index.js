const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { token } = require('./config/env');
const logger = require('./utils/logger');
const { createShutdownHandler } = require('./utils/shutdown');

// ShardingManager (src/shard.js) sets SHARDING_MANAGER plus SHARDS/SHARD_COUNT on every child it
// spawns — discord.js's Client only picks those up automatically when `shards`/`shardCount` are
// omitted entirely, so passing `shards: 'auto'` unconditionally here would override and discard
// the shard(s) ShardingManager actually assigned this process. Standalone (no ShardingManager,
// today's `npm start`), 'auto' asks Discord for its recommended shard count at connect time and
// shards internally within this one process if needed — for a low guild count that still resolves
// to a single shard, so this is a no-op change until the bot actually approaches Discord's
// ~2,500-guild sharding threshold.
const shardOptions = process.env.SHARDING_MANAGER ? {} : { shards: 'auto' };

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
  ...shardOptions,
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

const shutdown = createShutdownHandler({
  destroy: () => client.destroy(),
  exit: process.exit,
  logger,
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(token).catch((err) => {
  logger.error('Failed to log in:', err.message);
  process.exit(1);
});
