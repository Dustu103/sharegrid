/**
 * store.js
 * In-memory grid state store — the single source of truth for live tile data.
 *
 * Architecture note:
 *   This module is intentionally written with an interface that mirrors Redis
 *   Hash + TTL semantics. To swap in Redis, replace the Map operations with
 *   ioredis calls without changing callers.
 *
 * Concurrency model:
 *   Node.js is single-threaded, so Map operations are atomic from the
 *   perspective of the event loop. No additional locking is required for
 *   in-process use.
 */

const logger = require('../utils/logger');

class GridStore {
  constructor() {
    /** @type {Map<string, TileData>} key = "row:col" */
    this.grid = new Map();

    /**
     * Tile lock set: prevents re-capture during TILE_LOCK_MS window.
     * key = "lock:row:col", value = expiry timestamp (ms since epoch)
     * @type {Map<string, number>}
     */
    this.tileLocks = new Map();

    /**
     * Per-user cooldown registry.
     * key = userId, value = expiry timestamp
     * @type {Map<string, number>}
     */
    this.cooldowns = new Map();

    /**
     * Online users registry.
     * key = userId, value = UserRecord
     * @type {Map<string, UserRecord>}
     */
    this.users = new Map();

    /**
     * Rate limiter: tracks claim message count in current second.
     * key = userId, value = { count: number, windowStart: number }
     * @type {Map<string, RateWindow>}
     */
    this.rateWindows = new Map();

    logger.info('GridStore', 'In-memory store initialised');
  }

  // ── Tile Operations ──────────────────────────────────────────────────────

  /**
   * Attempt to claim a tile atomically.
   * Returns false if a lock exists for the tile (i.e., recently captured).
   *
   * @param {number} row
   * @param {number} col
   * @param {TileData} data
   * @param {number} lockMs  - How long to lock the tile after setting
   * @returns {boolean} true = success, false = locked
   */
  setTileAtomic(row, col, data, lockMs) {
    const lockKey = `lock:${row}:${col}`;
    const now = Date.now();

    // Check existing lock
    const lockExpiry = this.tileLocks.get(lockKey);
    if (lockExpiry && now < lockExpiry) {
      return false; // tile is locked
    }

    // Write tile
    this.grid.set(`${row}:${col}`, data);

    // Apply new lock
    if (lockMs > 0) {
      this.tileLocks.set(lockKey, now + lockMs);
      setTimeout(() => this.tileLocks.delete(lockKey), lockMs);
    }

    return true;
  }

  /**
   * @param {number} row
   * @param {number} col
   * @returns {TileData|null}
   */
  getTile(row, col) {
    return this.grid.get(`${row}:${col}`) ?? null;
  }

  /**
   * Returns the full grid as a plain object (JSON-serialisable).
   * @returns {Object.<string, TileData>}
   */
  getAllTiles() {
    const out = {};
    for (const [k, v] of this.grid) out[k] = v;
    return out;
  }

  /**
   * Forcibly clear a tile (used by decay system).
   */
  clearTile(row, col) {
    this.grid.delete(`${row}:${col}`);
  }

  // ── Cooldown Operations ──────────────────────────────────────────────────

  /**
   * @param {string} userId
   * @returns {boolean}
   */
  isOnCooldown(userId) {
    const expiry = this.cooldowns.get(userId);
    return !!expiry && Date.now() < expiry;
  }

  /**
   * @param {string} userId
   * @returns {number} ms remaining, 0 if not on cooldown
   */
  getCooldownRemaining(userId) {
    const expiry = this.cooldowns.get(userId);
    if (!expiry || Date.now() >= expiry) return 0;
    return expiry - Date.now();
  }

  /**
   * @param {string} userId
   * @param {number} ms
   */
  setCooldown(userId, ms) {
    const expiry = Date.now() + ms;
    this.cooldowns.set(userId, expiry);
    setTimeout(() => this.cooldowns.delete(userId), ms);
  }

  // ── Rate Limiting ─────────────────────────────────────────────────────────

  /**
   * Check and increment rate counter for a user.
   * @param {string} userId
   * @param {number} maxPerSec
   * @returns {boolean} true = allowed, false = rate limited
   */
  checkRateLimit(userId, maxPerSec) {
    const now  = Date.now();
    const win  = this.rateWindows.get(userId);

    if (!win || now - win.windowStart > 1000) {
      // Start fresh window
      this.rateWindows.set(userId, { count: 1, windowStart: now });
      return true;
    }

    if (win.count >= maxPerSec) return false;

    win.count++;
    return true;
  }

  // ── User Operations ───────────────────────────────────────────────────────

  /** @param {string} userId @param {UserRecord} data */
  addUser(userId, data) {
    this.users.set(userId, data);
  }

  /** @param {string} userId */
  removeUser(userId) {
    this.users.delete(userId);
    this.cooldowns.delete(userId);
    this.rateWindows.delete(userId);
  }

  /** @param {string} userId @returns {UserRecord|undefined} */
  getUser(userId) {
    return this.users.get(userId);
  }

  /** @returns {UserRecord[]} */
  getAllUsers() {
    return Array.from(this.users.values());
  }

  /** @param {string} userId @param {Partial<UserRecord>} patch */
  updateUser(userId, patch) {
    const existing = this.users.get(userId);
    if (existing) this.users.set(userId, { ...existing, ...patch });
  }

  /**
   * Increment a user's tile counters.
   * @param {string} userId
   * @param {number} currentDelta  e.g. +1 on claim, -1 on lose
   * @param {number} totalDelta    always +1 on claim (historical)
   */
  adjustUserTiles(userId, currentDelta, totalDelta = 0) {
    const user = this.users.get(userId);
    if (!user) return;
    user.currentTiles  = Math.max(0, (user.currentTiles  || 0) + currentDelta);
    user.totalCaptured = Math.max(0, (user.totalCaptured || 0) + totalDelta);
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────

  /**
   * Returns top-N users sorted by current tiles owned.
   * @param {number} n
   * @returns {UserRecord[]}
   */
  getLeaderboard(n = 20) {
    return Array.from(this.users.values())
      .sort((a, b) => (b.currentTiles || 0) - (a.currentTiles || 0))
      .slice(0, n)
      .map((u, i) => ({ ...u, rank: i + 1 }));
  }
}

// Singleton — one store per process
module.exports = new GridStore();

/**
 * @typedef {Object} TileData
 * @property {string} userId
 * @property {string} username
 * @property {string} color
 * @property {number} capturedAt   - Unix ms timestamp
 * @property {number} cooldownUntil
 */

/**
 * @typedef {Object} UserRecord
 * @property {string} userId
 * @property {string} username
 * @property {string} color
 * @property {number} connectedAt
 * @property {number} currentTiles
 * @property {number} totalCaptured
 */

/**
 * @typedef {Object} RateWindow
 * @property {number} count
 * @property {number} windowStart
 */
