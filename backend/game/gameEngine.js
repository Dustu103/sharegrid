/**
 * gameEngine.js — Core game logic layer
 * Every claim flows: messageRouter → claimTile() → store + db → result
 */

const RULES  = require('./rules');
const store  = require('../data/store');
const db     = require('../data/postgresDb');
const logger = require('../utils/logger');

function claimTile(userId, row, col) {
  // 1. Bounds check
  if (
    !Number.isInteger(row) || !Number.isInteger(col) ||
    row < 0 || row >= RULES.GRID_ROWS ||
    col < 0 || col >= RULES.GRID_COLS
  ) {
    return { success: false, reason: 'INVALID_POSITION' };
  }

  // 2. Rate limit
  if (!store.checkRateLimit(userId, RULES.RATE_LIMIT_PER_SEC)) {
    return { success: false, reason: 'RATE_LIMITED' };
  }

  // 3. User cooldown
  if (store.isOnCooldown(userId)) {
    return { success: false, reason: 'COOLDOWN_ACTIVE', cooldownMs: store.getCooldownRemaining(userId) };
  }

  // 4. User exists?
  const user = store.getUser(userId);
  if (!user) return { success: false, reason: 'UNKNOWN_USER' };

  // 5. Existing tile owner
  const existing  = store.getTile(row, col);
  const prevOwner = existing?.userId ?? null;
  const isRecapture = !!prevOwner && prevOwner !== userId;

  // 6. Atomic tile lock + write
  const now = Date.now();
  const tileData = {
    userId, username: user.username, color: user.color,
    capturedAt: now, cooldownUntil: now + RULES.USER_COOLDOWN_MS,
  };

  if (!store.setTileAtomic(row, col, tileData, RULES.TILE_LOCK_MS)) {
    return { success: false, reason: 'TILE_LOCKED' };
  }

  // 7. Cooldown + tile counters
  store.setCooldown(userId, RULES.USER_COOLDOWN_MS);
  store.adjustUserTiles(userId, +1, +1);
  if (prevOwner && prevOwner !== userId) store.adjustUserTiles(prevOwner, -1, 0);

  // 8. Persist
  const eventType = isRecapture ? 'recapture' : 'capture';
  db.upsertTile(row, col, tileData);
  db.recordEvent(row, col, { userId, username: user.username }, eventType);

  logger.debug('GameEngine', `Tile [${row},${col}] ${eventType} by ${user.username}`);
  return { success: true, tile: tileData, prevOwner };
}

function expireTile(row, col) {
  const existing = store.getTile(row, col);
  if (!existing) return null;
  store.clearTile(row, col);
  store.adjustUserTiles(existing.userId, -1, 0);
  db.clearTile(row, col);
  db.recordEvent(row, col, { userId: existing.userId, username: existing.username }, 'expire');
  return existing;
}

function registerUser(user) {
  store.addUser(user.userId, { ...user, currentTiles: 0, totalCaptured: 0, lastSeen: user.connectedAt });
  db.upsertUser({ id: user.userId, username: user.username, color: user.color,
    created_at: user.connectedAt, last_seen: user.connectedAt, total_captured: 0, current_tiles: 0 });
  logger.info('GameEngine', 'User registered', { username: user.username });
}

function unregisterUser(userId) {
  const user = store.getUser(userId);
  if (user) {
    db.upsertUser({ id: userId, username: user.username, color: user.color,
      created_at: user.connectedAt, last_seen: Date.now(),
      total_captured: user.totalCaptured, current_tiles: user.currentTiles });
  }
  store.removeUser(userId);
}

async function restoreGridFromDb() {
  const rows = await db.loadAllTiles();
  for (const r of rows) {
    store.grid.set(`${r.row}:${r.col}`, {
      userId: r.user_id, username: r.username, color: r.color,
      capturedAt: r.captured_at, cooldownUntil: 0,
    });
  }
  logger.info('GameEngine', `Grid restored`, { tiles: rows.length });
}

module.exports = { claimTile, expireTile, registerUser, unregisterUser, restoreGridFromDb };
