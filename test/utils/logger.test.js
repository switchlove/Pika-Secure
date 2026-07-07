import { describe, it, expect, vi, afterEach } from 'vitest';
import logger from '../../src/utils/logger.js';

const PREFIX_PATTERN = (level) =>
  new RegExp(`^\\[\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\] \\[${level}\\]$`);

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs info messages with a timestamp and level tag', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('hello', 42);
    expect(spy).toHaveBeenCalledTimes(1);
    const [prefix, ...rest] = spy.mock.calls[0];
    expect(prefix).toMatch(PREFIX_PATTERN('INFO'));
    expect(rest).toEqual(['hello', 42]);
  });

  it('logs warn messages via console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('careful');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(PREFIX_PATTERN('WARN'));
  });

  it('logs error messages via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('boom');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(PREFIX_PATTERN('ERROR'));
  });
});
