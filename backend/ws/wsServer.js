/**
 * wsServer.js
 * WebSocket server lifecycle: upgrade, heartbeat, decay, leaderboard broadcast.
 *
 * Heartbeat pattern:
 *   Every HEARTBEAT_INTERVAL_MS the server sends a PING frame.
 *   If the client doesn't pong within HEARTBEAT_TIMEOUT_MS → terminate.
 *
 * Decay system:
 *   If TILE_DECAY_ENABLED, a timer checks all tiles and expires ones
 *   older than TILE_DECAY_MS since last capture.
 */

const WebSocket    = require('ws');
const RULES        = require('../game/rules');
const engine       = require('../game/gameEngine');
const store        = require('../data/store');
const db           = require('../data/sqliteDb');
const router       = require('./messageRouter');
const broadcaster  = require('./broadcaster');
const redisClient  = require('../data/redisClient');
const logger       = require('../utils/logger');

/**
 * Attach WebSocket handling to an existing HTTP server.
 * Redis clients are injected into broadcaster for cross-instance pub/sub.
 * @param {import('http').Server} httpServer
 */
function attach(httpServer) {
  const wss = new WebSocket.Server({
    server: httpServer,
    maxPayload: 2048,
    clientTracking: true,
  });

  // Pass Redis clients if available (graceful no-op if not connected)
  const pub = redisClient.isConnected() ? redisClient.pub : null;
  const sub = redisClient.isConnected() ? redisClient.sub : null;
  broadcaster.init(wss, pub, sub);

  logger.info('WSServer', `Instance ${broadcaster.INSTANCE_ID} started`, {
    redisEnabled: !!pub,
  });

  // ── Connection handler ──────────────────────────────────────────────────
  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logger.info('WSServer', 'New connection', { ip });

    ws.isAlive  = true;
    ws.userId   = null;         // set after JOIN

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        router.route(ws, raw);
      } catch (err) {
        logger.error('WSServer', 'Unhandled route error', { err: err.message });
      }
    });

    ws.on('close', (code, reason) => {
      const userId = ws.userId;
      if (userId) {
        engine.unregisterUser(userId);
        broadcaster.broadcast('USER_LEFT', { userId }, [ws]);
        logger.info('WSServer', 'User disconnected', { userId, code });
      }
    });

    ws.on('error', (err) => {
      logger.warn('WSServer', 'Socket error', { err: err.message });
    });
  });

  wss.on('error', (err) => {
    logger.error('WSServer', 'Server error', { err: err.message });
  });

  // ── Heartbeat timer ─────────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        logger.warn('WSServer', 'Dead socket terminated', { userId: ws.userId });
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, RULES.HEARTBEAT_INTERVAL_MS);

  // ── Leaderboard broadcast timer ─────────────────────────────────────────
  const leaderTimer = setInterval(() => {
    if (wss.clients.size === 0) return;
    const leaderboard = store.getLeaderboard(RULES.LEADERBOARD_SIZE);
    broadcaster.broadcastAll('LEADERBOARD_UPDATE', { leaderboard });
  }, RULES.LEADERBOARD_BROADCAST_INTERVAL_MS);

  // ── Periodic SQLite sync (flush in-memory stats to disk) ────────────────
  const syncTimer = setInterval(() => {
    const users = store.getAllUsers();
    if (users.length > 0) db.batchUpdateUsers(users);
  }, 30_000);

  // ── Tile decay timer ─────────────────────────────────────────────────────
  let decayTimer = null;
  if (RULES.TILE_DECAY_ENABLED) {
    decayTimer = setInterval(() => {
      const now  = Date.now();
      const grid = store.getAllTiles();
      for (const [key, tile] of Object.entries(grid)) {
        if (now - tile.capturedAt > RULES.TILE_DECAY_MS) {
          const [r, c] = key.split(':').map(Number);
          const expired = engine.expireTile(r, c);
          if (expired) {
            broadcaster.broadcastAll('TILE_EXPIRED', { row: r, col: c, prevOwner: expired.userId });
          }
        }
      }
    }, 60_000); // run every minute
  }

  // ── Cleanup on process exit ──────────────────────────────────────────────
  function cleanup() {
    clearInterval(heartbeat);
    clearInterval(leaderTimer);
    clearInterval(syncTimer);
    if (decayTimer) clearInterval(decayTimer);
    wss.close();
  }
  process.on('SIGTERM', cleanup);
  process.on('SIGINT',  cleanup);

  logger.info('WSServer', 'WebSocket server ready', {
    heartbeatMs:  RULES.HEARTBEAT_INTERVAL_MS,
    decayEnabled: RULES.TILE_DECAY_ENABLED,
  });

  return wss;
}

module.exports = { attach };
