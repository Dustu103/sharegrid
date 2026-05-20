/**
 * messageRouter.js
 * Routes incoming WebSocket messages to the appropriate handler.
 * Each handler is pure: receives (ws, userId, payload) → calls game engine → broadcasts.
 *
 * Message types handled:
 *   JOIN        → register user, send WELCOME
 *   CLAIM_TILE  → attempt capture, broadcast result
 *   PING        → respond PONG, update lastSeen
 */

const { v4: uuidv4 }        = require('uuid');
const RULES                 = require('../game/rules');
const engine                = require('../game/gameEngine');
const store                 = require('../data/store');
const { assignColor }       = require('../utils/colorAssigner');
const { sendTo, broadcast } = require('./broadcaster');
const logger                = require('../utils/logger');

// Sanitise user-supplied strings
function sanitise(str = '', maxLen = 30) {
  return String(str)
    .replace(/[<>&"'`]/g, '')
    .trim()
    .slice(0, maxLen);
}

// ── Handlers ─────────────────────────────────────────────────────────────

function handleJoin(ws, _userId, payload) {
  // Allow re-join with a preferred userId (reconnect scenario)
  const userId   = sanitise(payload.userId || '', 36) || uuidv4();
  const username = sanitise(payload.username || 'Anonymous', RULES.USERNAME_MAX_LENGTH)
                   || 'Anonymous';
  const color    = assignColor(userId);

  // Tag the socket with the userId for future messages
  ws.userId = userId;

  engine.registerUser({ userId, username, color, connectedAt: Date.now() });

  // Send full grid state + rules to the joining client
  sendTo(ws, 'WELCOME', {
    userId,
    username,
    color,
    gridState:   store.getAllTiles(),
    onlineUsers: store.getAllUsers(),
    rules: {
      gridRows:      RULES.GRID_ROWS,
      gridCols:      RULES.GRID_COLS,
      cooldownMs:    RULES.USER_COOLDOWN_MS,
      tileLockMs:    RULES.TILE_LOCK_MS,
      fortressMin:   RULES.FORTRESS_MIN_TILES,
      decayEnabled:  RULES.TILE_DECAY_ENABLED,
      decayMs:       RULES.TILE_DECAY_MS,
    },
  });

  // Notify everyone else
  broadcast('USER_JOINED', { userId, username, color }, [ws]);

  logger.info('MsgRouter', `User joined`, { userId, username });
}

function handleClaimTile(ws, userId, payload) {
  if (!userId) {
    return sendTo(ws, 'ERROR', { code: 'NOT_JOINED', message: 'Send JOIN first' });
  }

  const row = Number(payload.row);
  const col = Number(payload.col);

  const result = engine.claimTile(userId, row, col);

  if (!result.success) {
    sendTo(ws, 'TILE_REJECTED', {
      row, col,
      reason:      result.reason,
      cooldownMs:  result.cooldownMs ?? 0,
    });
    return;
  }

  // Broadcast to all clients (including the claimer)
  broadcast('TILE_UPDATED', {
    row, col,
    owner:          result.tile,
    prevOwner:      result.prevOwner,
    leaderboard:    store.getLeaderboard(RULES.LEADERBOARD_SIZE),
  });
}

function handlePing(ws, userId) {
  if (userId) store.updateUser(userId, { lastSeen: Date.now() });
  sendTo(ws, 'PONG', {});
}

// ── Router ────────────────────────────────────────────────────────────────

/**
 * Parse and route a raw WebSocket message string.
 * @param {WebSocket} ws
 * @param {string|Buffer} raw
 */
function route(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return sendTo(ws, 'ERROR', { code: 'INVALID_JSON', message: 'Malformed message' });
  }

  const { type, ...payload } = msg;
  const userId = ws.userId ?? null;

  // Guard oversized messages (already enforced at WS layer but belt + braces)
  if (raw.length > 2048) {
    return sendTo(ws, 'ERROR', { code: 'MESSAGE_TOO_LARGE', message: 'Max 2 KB' });
  }

  switch (type) {
    case 'JOIN':       return handleJoin(ws, userId, payload);
    case 'CLAIM_TILE': return handleClaimTile(ws, userId, payload);
    case 'PING':       return handlePing(ws, userId);
    default:
      sendTo(ws, 'ERROR', { code: 'UNKNOWN_TYPE', message: `Unknown type: ${type}` });
  }
}

module.exports = { route };
