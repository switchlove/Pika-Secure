const path = require('node:path');
const { ShardingManager } = require('discord.js');
const { token } = require('./config/env');
const logger = require('./utils/logger');

// This file only spawns and supervises child processes — it must never require('./database/db')
// or anything that transitively does (any ./database/* or ./verification/* module), since it has
// no reason to open its own handle on the shared SQLite file; each spawned src/index.js child
// opens its own connection as usual.

// 'auto' (the default) asks Discord for its recommended shard count at spawn time — the same
// mechanism src/index.js uses for standalone internal auto-sharding, so there's a single source of
// truth for "how many shards does this bot need". SHARD_COUNT lets an operator pin an explicit
// count instead (e.g. to keep guild-to-shard mapping stable across restarts) — reusing that name
// since it's the same env var discord.js's own Client/Shard already read.
const totalShards = process.env.SHARD_COUNT ? Number(process.env.SHARD_COUNT) : 'auto';

const manager = new ShardingManager(path.join(__dirname, 'index.js'), {
  token,
  totalShards,
  mode: 'process',
  respawn: true,
});

manager.on('shardCreate', (shard) => {
  logger.info(`Launched shard ${shard.id}.`);
});

manager.spawn().catch((err) => {
  logger.error('Failed to spawn shards:', err.message);
  process.exit(1);
});

// Each child (src/index.js) already handles its own SIGINT/SIGTERM gracefully via
// createShutdownHandler (awaits client.destroy() with a timeout, then process.exit(0)). Without a
// handler here, killing this manager process would leave orphaned children running — fork() does
// not kill children when the parent exits — or a child exiting during an intentional shutdown
// would just get relaunched by `respawn: true`. shard.kill() sends the child a normal SIGTERM
// (triggering its own graceful shutdown) and marks that shard as deliberately stopped so
// `respawn` doesn't relaunch it.
function shutdown(signal) {
  logger.info(`Received ${signal}, stopping all shards.`);
  for (const shard of manager.shards.values()) {
    shard.kill();
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
