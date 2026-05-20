/**
 * redisClient.js
 * Manages two ioredis connections:
 *   pub — regular commands (GET, SET, HSET, PUBLISH, …)
 *   sub — dedicated SUBSCRIBE connection (ioredis rule: a subscriber
 *         client can only receive messages, not send other commands)
 *
 * Falls back gracefully: if Redis is unreachable, the app continues
 * with in-memory state only (single-instance mode).
 */

const Redis  = require('ioredis');
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/** Shared ioredis options */
const BASE_OPTS = {
  lazyConnect:          true,
  enableReadyCheck:     true,
  maxRetriesPerRequest: 3,
  connectTimeout:       5000,
  retryStrategy(times) {
    if (times > 10) return null;           // stop retrying after 10 attempts
    return Math.min(times * 200, 3000);    // exponential backoff, max 3s
  },
};

// ── Publisher client (all normal commands + PUBLISH) ─────────────────────────
const pub = new Redis(REDIS_URL, { ...BASE_OPTS, connectionName: 'sg-pub' });

// ── Subscriber client (SUBSCRIBE / PSUBSCRIBE only) ───────────────────────────
const sub = new Redis(REDIS_URL, { ...BASE_OPTS, connectionName: 'sg-sub' });

let _connected = false;

pub.on('ready', () => {
  _connected = true;
  logger.info('Redis', 'Publisher ready', { url: REDIS_URL });
});
pub.on('error', (e) => {
  _connected = false;
  logger.warn('Redis', 'Publisher error', { err: e.message });
});
pub.on('close', () => { _connected = false; });

sub.on('ready', () => logger.info('Redis', 'Subscriber ready'));
sub.on('error', (e) => logger.warn('Redis', 'Subscriber error', { err: e.message }));

/**
 * Attempt to connect both clients.
 * Resolves even if Redis is unavailable (graceful degradation).
 */
async function connect() {
  try {
    await Promise.all([pub.connect(), sub.connect()]);
    logger.info('Redis', 'Both clients connected ✓');
  } catch (err) {
    logger.warn('Redis', 'Unavailable — running in single-instance mode', {
      err: err.message,
    });
  }
}

/** @returns {boolean} */
function isConnected() { return _connected; }

module.exports = { pub, sub, connect, isConnected };
