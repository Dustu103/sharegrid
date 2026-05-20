/**
 * broadcaster.js
 * Fan-out engine with Redis Pub/Sub for horizontal scaling.
 *
 * Single-instance mode  (Redis absent):
 *   Messages are sent directly to local WebSocket clients.
 *
 * Multi-instance mode  (Redis present):
 *   1. Caller broadcasts locally (to this instance's WS clients).
 *   2. Message is also PUBLISHED to Redis channel `sharegrid:events`.
 *   3. Every OTHER instance is subscribed → receives the message →
 *      broadcasts to its own local WS clients.
 *   4. A `_src` field prevents an instance from re-broadcasting its
 *      own messages when the Redis echo arrives.
 */

const crypto    = require('crypto');
const WebSocket = require('ws');
const logger    = require('../utils/logger');

/** Unique ID for this process / instance */
const INSTANCE_ID   = crypto.randomBytes(8).toString('hex');
const REDIS_CHANNEL = 'sharegrid:events';

/** @type {import('ws').Server|null} */
let wss = null;
/** @type {import('ioredis').Redis|null} */
let redisPub = null;

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Must be called once after the WS server is created.
 * @param {import('ws').Server} wsServer
 * @param {import('ioredis').Redis|null} [pub]  Redis publisher client
 * @param {import('ioredis').Redis|null} [sub]  Redis subscriber client
 */
function init(wsServer, pub = null, sub = null) {
  wss      = wsServer;
  redisPub = pub;

  if (sub) {
    sub.subscribe(REDIS_CHANNEL, (err) => {
      if (err) {
        logger.warn('Broadcaster', 'Redis subscribe failed — local-only mode', {
          err: err.message,
        });
      } else {
        logger.info('Broadcaster', `Subscribed to "${REDIS_CHANNEL}" (multi-instance ready)`);
      }
    });

    // When a remote instance publishes, broadcast locally
    sub.on('message', (channel, raw) => {
      if (channel !== REDIS_CHANNEL) return;
      try {
        const msg = JSON.parse(raw);
        if (msg._src === INSTANCE_ID) return; // skip our own echoes
        _sendToLocalClients(raw, []);
      } catch { /* malformed — ignore */ }
    });
  }
}

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Send a pre-serialised string to all local WS clients (with optional exclusions).
 * @param {string}      msgStr
 * @param {WebSocket[]} exclude
 */
function _sendToLocalClients(msgStr, exclude) {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && !exclude.includes(client)) {
      try { client.send(msgStr); } catch { /* ignore closed sockets */ }
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a typed message to a single WebSocket connection.
 * @param {WebSocket} ws
 * @param {string}   type
 * @param {Object}   [payload]
 */
function sendTo(ws, type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type, ...payload, ts: Date.now() }));
  } catch (err) {
    logger.warn('Broadcaster', 'sendTo failed', { type, err: err.message });
  }
}

/**
 * Broadcast a typed message to all connected clients.
 *   - Sends locally immediately.
 *   - Publishes to Redis so other instances also broadcast it.
 *
 * @param {string}      type
 * @param {Object}      [payload]
 * @param {WebSocket[]} [exclude]  sockets to skip locally
 */
function broadcast(type, payload = {}, exclude = []) {
  const msgStr = JSON.stringify({
    type, ...payload,
    ts:   Date.now(),
    _src: INSTANCE_ID,   // stripped by receiver if coming from Redis
  });

  // 1. Local fan-out (immediate)
  _sendToLocalClients(msgStr, exclude);

  // 2. Cross-instance via Redis (fire-and-forget)
  if (redisPub) {
    redisPub.publish(REDIS_CHANNEL, msgStr).catch((err) => {
      logger.warn('Broadcaster', 'Redis publish failed', { err: err.message });
    });
  }
}

/** Broadcast to ALL clients including sender (no exclusions). */
function broadcastAll(type, payload = {}) {
  broadcast(type, payload, []);
}

module.exports = { init, sendTo, broadcast, broadcastAll, INSTANCE_ID };
