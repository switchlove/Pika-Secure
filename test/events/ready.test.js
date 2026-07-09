import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let sweeper;
let logger;
let ready;

beforeEach(() => {
  bustSrcRequireCache(require);
  sweeper = injectFakeModule(require, '../../src/scheduler/sweeper.js', { start: vi.fn() });
  logger = injectFakeModule(require, '../../src/utils/logger.js', { warn: vi.fn(), error: vi.fn(), info: vi.fn() });
  ready = require('../../src/events/ready.js');
});

describe('ready', () => {
  it('is registered as a one-time clientReady handler', () => {
    expect(ready.name).toBe('clientReady');
    expect(ready.once).toBe(true);
  });

  it('logs the login and starts the sweeper', () => {
    const client = { user: { tag: 'PikaSecure#0001' } };

    ready.execute(client);

    expect(logger.info).toHaveBeenCalledWith('Logged in as PikaSecure#0001');
    expect(sweeper.start).toHaveBeenCalledWith(client);
  });
});
