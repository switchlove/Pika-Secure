const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { error: 0, warn: 1, info: 2 };
const configuredLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

// Opt-in: set LOG_DIR to also append warn/error lines to a daily-rotating file, in addition to
// the console output every deployment already gets. Off by default so a bare install doesn't
// start writing files nobody asked for — useful on hosts where stdout isn't captured/retained,
// so errors aren't only visible to whoever happens to be tailing the process live.
const logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : null;

function timestamp() {
  return new Date().toISOString();
}

// Collapses embedded newlines so a single logged value can't inject extra lines into the file
// log (e.g. a crafted username or error message forging a fake "[TIMESTAMP] [LEVEL]" entry).
// Escaped rather than stripped so the original content is still fully recoverable.
function sanitizeForLog(str) {
  return str.replace(/\r\n|\r|\n/g, '\\n');
}

function formatArg(arg) {
  if (arg instanceof Error) return sanitizeForLog(arg.stack || arg.message);
  return typeof arg === 'string' ? sanitizeForLog(arg) : JSON.stringify(arg);
}

function writeToFile(levelLabel, args) {
  if (!logDir) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const dateStamp = timestamp().slice(0, 10);
    const file = path.join(logDir, `pikasecure-${dateStamp}.log`);
    const line = `[${timestamp()}] [${levelLabel}] ${args.map(formatArg).join(' ')}\n`;
    fs.appendFileSync(file, line);
  } catch {
    // File logging is best-effort — never let a disk/permission issue break the console log
    // it's supplementing, or take down whatever call site (including error handlers) logged.
  }
}

function log(level, consoleFn, args) {
  if (LEVELS[level] > configuredLevel) return;
  const levelLabel = level.toUpperCase();
  consoleFn(`[${timestamp()}] [${levelLabel}]`, ...args);
  if (level === 'warn' || level === 'error') writeToFile(levelLabel, args);
}

module.exports = {
  info: (...args) => log('info', console.log, args),
  warn: (...args) => log('warn', console.warn, args),
  error: (...args) => log('error', console.error, args),
};
