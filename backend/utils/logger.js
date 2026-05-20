/**
 * logger.js
 * Lightweight structured logger.
 * Outputs coloured, timestamped lines without external dependencies.
 * Production: set LOG_LEVEL=warn or LOG_LEVEL=error.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[36m',  // cyan
  info:  '\x1b[32m',  // green
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
};

const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, context, message, meta = {}) {
  if (LEVELS[level] < currentLevel) return;

  const ts    = new Date().toISOString();
  const color = COLORS[level] ?? '';
  const reset = COLORS.reset;
  const metaStr = Object.keys(meta).length
    ? ' ' + JSON.stringify(meta)
    : '';

  process.stdout.write(
    `${color}[${ts}] [${level.toUpperCase()}] [${context}] ${message}${metaStr}${reset}\n`
  );
}

const logger = {
  debug: (ctx, msg, meta)  => log('debug', ctx, msg, meta),
  info:  (ctx, msg, meta)  => log('info',  ctx, msg, meta),
  warn:  (ctx, msg, meta)  => log('warn',  ctx, msg, meta),
  error: (ctx, msg, meta)  => log('error', ctx, msg, meta),
};

module.exports = logger;
