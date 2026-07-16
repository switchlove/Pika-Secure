import { describe, it, expect, vi } from 'vitest';
import { createShutdownHandler } from '../../src/utils/shutdown.js';

function makeDeps() {
  return {
    destroy: vi.fn(),
    exit: vi.fn(),
    logger: { info: vi.fn() },
  };
}

describe('createShutdownHandler', () => {
  it('does not call destroy/exit before the handler is invoked', () => {
    const deps = makeDeps();
    createShutdownHandler(deps);
    expect(deps.destroy).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('logs, destroys, and exits(0) on the first call', () => {
    const deps = makeDeps();
    const shutdown = createShutdownHandler(deps);

    shutdown('SIGTERM');

    expect(deps.logger.info).toHaveBeenCalledWith('Received SIGTERM, shutting down.');
    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('is idempotent: a second call is ignored', () => {
    const deps = makeDeps();
    const shutdown = createShutdownHandler(deps);

    shutdown('SIGINT');
    shutdown('SIGINT');
    shutdown('SIGTERM');

    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
  });

  it('tracks shuttingDown independently per handler instance', () => {
    const depsA = makeDeps();
    const depsB = makeDeps();
    const shutdownA = createShutdownHandler(depsA);
    const shutdownB = createShutdownHandler(depsB);

    shutdownA('SIGINT');

    expect(depsA.destroy).toHaveBeenCalledTimes(1);
    expect(depsB.destroy).not.toHaveBeenCalled();

    shutdownB('SIGTERM');
    expect(depsB.destroy).toHaveBeenCalledTimes(1);
  });
});
