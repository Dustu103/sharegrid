/**
 * rules.js
 * Single source of truth for all game constants.
 * Override via .env for easy tuning without code changes.
 */
require('dotenv').config();

const RULES = {
  // ── Grid Dimensions ──────────────────────────────────────────────────────
  GRID_ROWS:   parseInt(process.env.GRID_ROWS)  || 40,
  GRID_COLS:   parseInt(process.env.GRID_COLS)  || 50,
  get TOTAL_TILES() { return this.GRID_ROWS * this.GRID_COLS; },

  // ── Claim Rules ───────────────────────────────────────────────────────────
  /** Milliseconds a user must wait between successive claims */
  USER_COOLDOWN_MS: parseInt(process.env.USER_COOLDOWN_MS) || 3000,

  /** Milliseconds after capture during which the tile CANNOT be stolen */
  TILE_LOCK_MS: parseInt(process.env.TILE_LOCK_MS) || 1000,

  /** Soft cap: user's tiles can still be stolen above this number */
  MAX_TILES_PER_USER: 500,

  // ── Decay System ──────────────────────────────────────────────────────────
  /** If true, idle tiles return to neutral after TILE_DECAY_MS */
  TILE_DECAY_ENABLED: process.env.TILE_DECAY_ENABLED === 'true' || false,
  TILE_DECAY_MS: parseInt(process.env.TILE_DECAY_MS) || 5 * 60 * 1000,

  // ── Fortress / Area Control ───────────────────────────────────────────────
  /** Min tiles a user must own in a 3×3 area to trigger "fortress" glow */
  FORTRESS_MIN_TILES: 5,

  // ── Rate Limiting ─────────────────────────────────────────────────────────
  /** Max CLAIM_TILE messages allowed per second per connection */
  RATE_LIMIT_PER_SEC: 3,

  // ── Session ───────────────────────────────────────────────────────────────
  /** Client is considered idle after this many ms without a PING */
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,

  // ── Broadcasting ─────────────────────────────────────────────────────────
  /** How often the leaderboard is broadcast to all clients (ms) */
  LEADERBOARD_BROADCAST_INTERVAL_MS: 5000,

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  HEARTBEAT_INTERVAL_MS: 30_000,
  HEARTBEAT_TIMEOUT_MS:  10_000,

  // ── Leaderboard ──────────────────────────────────────────────────────────
  LEADERBOARD_SIZE: 20,

  // ── Username ──────────────────────────────────────────────────────────────
  USERNAME_MAX_LENGTH: 20,
  USERNAME_MIN_LENGTH: 2,
};

module.exports = Object.freeze(RULES);
