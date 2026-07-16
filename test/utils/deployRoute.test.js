import { describe, it, expect, vi } from 'vitest';
import { resolveDeployRoute } from '../../src/utils/deployRoute.js';

function makeRoutes() {
  return {
    applicationGuildCommands: vi.fn((clientId, guildId) => `guild:${clientId}:${guildId}`),
    applicationCommands: vi.fn((clientId) => `global:${clientId}`),
  };
}

describe('resolveDeployRoute', () => {
  it('scopes to the dev guild when devGuildId is set and --global was not passed', () => {
    const Routes = makeRoutes();
    const result = resolveDeployRoute({
      Routes,
      clientId: 'client-1',
      devGuildId: 'guild-1',
      forceGlobal: false,
    });

    expect(result.useGuildScope).toBe(true);
    expect(result.route).toBe('guild:client-1:guild-1');
    expect(Routes.applicationGuildCommands).toHaveBeenCalledWith('client-1', 'guild-1');
    expect(Routes.applicationCommands).not.toHaveBeenCalled();
  });

  it('registers globally when no devGuildId is configured', () => {
    const Routes = makeRoutes();
    const result = resolveDeployRoute({
      Routes,
      clientId: 'client-1',
      devGuildId: null,
      forceGlobal: false,
    });

    expect(result.useGuildScope).toBe(false);
    expect(result.route).toBe('global:client-1');
    expect(Routes.applicationCommands).toHaveBeenCalledWith('client-1');
    expect(Routes.applicationGuildCommands).not.toHaveBeenCalled();
  });

  it('registers globally when --global is passed even if devGuildId is set', () => {
    const Routes = makeRoutes();
    const result = resolveDeployRoute({
      Routes,
      clientId: 'client-1',
      devGuildId: 'guild-1',
      forceGlobal: true,
    });

    expect(result.useGuildScope).toBe(false);
    expect(result.route).toBe('global:client-1');
    expect(Routes.applicationGuildCommands).not.toHaveBeenCalled();
  });
});
