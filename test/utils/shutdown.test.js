import { describe, it, expect, vi } from 'vitest';
import { createShutdownHandler } from '../../src/utils/shutdown.js';

function makeDeps() {
  return {
    destroy: vi.fn(),
    exit: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

describe('createShutdownHandler', () => {
  it('does not call destroy/exit before the handler is invoked', () => {
    const deps = makeDeps();
    createShutdownHandler(deps);
    expect(deps.destroy).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('logs, destroys, and exits(0) on the first call', async () => {
    const deps = makeDeps();
    const shutdown = createShutdownHandler(deps);

    await shutdown('SIGTERM');

    expect(deps.logger.info).toHaveBeenCalledWith('Received SIGTERM, shutting down.');
    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('is idempotent: a second call is ignored', async () => {
    const deps = makeDeps();
    const shutdown = createShutdownHandler(deps);

    await shutdown('SIGINT');
    await shutdown('SIGINT');
    await shutdown('SIGTERM');

    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
  });

  it('marks itself as shutting down synchronously, before destroy() resolves', async () => {
    const deps = makeDeps();
    let resolveDestroy;
    deps.destroy.mockReturnValue(new Promise((resolve) => (resolveDestroy = resolve)));
    const shutdown = createShutdownHandler(deps);

    const first = shutdown('SIGINT');
    const second = shutdown('SIGINT'); // fired before `first` has awaited anything

    resolveDestroy();
    await Promise.all([first, second]);

    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('tracks shuttingDown independently per handler instance', async () => {
    const depsA = makeDeps();
    const depsB = makeDeps();
    const shutdownA = createShutdownHandler(depsA);
    const shutdownB = createShutdownHandler(depsB);

    await shutdownA('SIGINT');

    expect(depsA.destroy).toHaveBeenCalledTimes(1);
    expect(depsB.destroy).not.toHaveBeenCalled();

    await shutdownB('SIGTERM');
    expect(depsB.destroy).toHaveBeenCalledTimes(1);
  });

  it('awaits destroy() before calling exit', async () => {
    const deps = makeDeps();
    let resolveDestroy;
    deps.destroy.mockReturnValue(new Promise((resolve) => (resolveDestroy = resolve)));
    const shutdown = createShutdownHandler(deps);

    const pending = shutdown('SIGTERM');
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.exit).not.toHaveBeenCalled();

    resolveDestroy();
    await pending;
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('falls back to exit after the timeout if destroy() hangs', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps();
      deps.destroy.mockReturnValue(new Promise(() => {}));
      const shutdown = createShutdownHandler({ ...deps, timeoutMs: 5000 });

      const pending = shutdown('SIGTERM');
      await vi.advanceTimersByTimeAsync(5000);
      await pending;

      expect(deps.exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('catches a rejected destroy() and still exits', async () => {
    const deps = makeDeps();
    deps.destroy.mockReturnValue(Promise.reject(new Error('gateway close failed')));
    const shutdown = createShutdownHandler(deps);

    await shutdown('SIGTERM');

    expect(deps.logger.error).toHaveBeenCalledWith(
      'Error while destroying client during shutdown:',
      'gateway close failed',
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});
