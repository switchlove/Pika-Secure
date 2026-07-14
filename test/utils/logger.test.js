import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('LOG_LEVEL filtering', () => {
  const originalLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('suppresses info logs when LOG_LEVEL=warn', async () => {
    process.env.LOG_LEVEL = 'warn';
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    scopedLogger.info('quiet please');
    scopedLogger.warn('still shown');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses info and warn logs when LOG_LEVEL=error', async () => {
    process.env.LOG_LEVEL = 'error';
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    scopedLogger.info('quiet');
    scopedLogger.warn('quiet too');
    scopedLogger.error('shown');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('logs everything by default when LOG_LEVEL is unset', async () => {
    delete process.env.LOG_LEVEL;
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    scopedLogger.info('shown by default');

    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});

describe('LOG_DIR file logging', () => {
  let tmpDir;
  const originalLogDir = process.env.LOG_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikasecure-log-'));
  });

  afterEach(() => {
    if (originalLogDir === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = originalLogDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does not write any file when LOG_DIR is unset', async () => {
    delete process.env.LOG_DIR;
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    scopedLogger.error('boom');

    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('appends warn/error lines to a dated file under LOG_DIR', async () => {
    process.env.LOG_DIR = tmpDir;
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    scopedLogger.warn('careful');
    scopedLogger.error('boom');

    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    expect(content).toContain('[WARN] careful');
    expect(content).toContain('[ERROR] boom');
  });

  it('formats an Error arg as its stack in the file, and non-string args as JSON', async () => {
    process.env.LOG_DIR = tmpDir;
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    scopedLogger.error('context:', new Error('boom'), { detail: 42 });

    const files = fs.readdirSync(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    expect(content).toContain('Error: boom');
    expect(content).toContain('{"detail":42}');
  });

  it('escapes embedded newlines in a string arg so it cannot forge extra log lines', async () => {
    process.env.LOG_DIR = tmpDir;
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    scopedLogger.warn('evil user: "\n[2020-01-01T00:00:00.000Z] [ERROR] fake entry"');

    const files = fs.readdirSync(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('\\n[2020-01-01T00:00:00.000Z] [ERROR] fake entry');
  });

  it('escapes embedded newlines in an Error stack written to the file', async () => {
    process.env.LOG_DIR = tmpDir;
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    scopedLogger.error(new Error('boom'));

    const files = fs.readdirSync(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Error: boom');
  });

  it('does not write info lines to the file', async () => {
    process.env.LOG_DIR = tmpDir;
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    scopedLogger.info('just fyi');

    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('never throws even if the log directory cannot be created', async () => {
    const blockerFile = path.join(tmpDir, 'blocked-file');
    fs.writeFileSync(blockerFile, ''); // occupies the path segment so mkdir(recursive) fails
    process.env.LOG_DIR = path.join(blockerFile, 'logs');
    vi.resetModules();
    const { default: scopedLogger } = await import('../../src/utils/logger.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => scopedLogger.error('still safe')).not.toThrow();
  });
});
