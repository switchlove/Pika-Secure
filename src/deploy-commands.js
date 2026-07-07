const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { token, clientId, devGuildId } = require('./config/env');
const logger = require('./utils/logger');

const commandsPath = path.join(__dirname, 'commands');
const commands = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js'))
  .map((file) => require(path.join(commandsPath, file)).data.toJSON());

const rest = new REST().setToken(token);
const forceGlobal = process.argv.includes('--global');
const useGuildScope = devGuildId && !forceGlobal;

(async () => {
  try {
    const route = useGuildScope
      ? Routes.applicationGuildCommands(clientId, devGuildId)
      : Routes.applicationCommands(clientId);

    const result = await rest.put(route, { body: commands });
    logger.info(
      `Registered ${result.length} slash command(s) ${useGuildScope ? `to guild ${devGuildId}` : 'globally'}.`,
    );
  } catch (err) {
    logger.error('Failed to register slash commands:', err);
    process.exitCode = 1;
  }
})();
