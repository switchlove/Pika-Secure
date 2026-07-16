// Extracted so the guild-vs-global route decision is unit-testable without constructing a real
// discord.js REST client or hitting the network.
function resolveDeployRoute({ Routes, clientId, devGuildId, forceGlobal }) {
  const useGuildScope = Boolean(devGuildId) && !forceGlobal;
  return {
    route: useGuildScope
      ? Routes.applicationGuildCommands(clientId, devGuildId)
      : Routes.applicationCommands(clientId),
    useGuildScope,
  };
}

module.exports = { resolveDeployRoute };
