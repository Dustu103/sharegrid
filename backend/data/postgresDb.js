/**
 * postgresDb.js
 * PostgreSQL persistence layer via the official pg client.
 *
 * Responsibilities:
 *   - Bootstrap schema on startup (idempotent, using transactions)
 *   - Persist tile ownership for server restarts
 *   - Record historical tile events (audit trail)
 *   - Upsert user records for leaderboard history
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  logger.error('PostgresDb', 'DATABASE_URL environment variable is not defined!');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

// ── Schema bootstrap ──────────────────────────────────────────────────────
async function bootstrapSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // User registry (ephemeral session data, no auth)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              TEXT PRIMARY KEY,
        username        TEXT NOT NULL,
        color           TEXT NOT NULL,
        created_at      BIGINT NOT NULL,
        last_seen       BIGINT NOT NULL,
        total_captured  INTEGER NOT NULL DEFAULT 0,
        current_tiles   INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Tile ownership snapshot (restored on server restart)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tile_ownership (
        row         INTEGER NOT NULL,
        col         INTEGER NOT NULL,
        user_id     TEXT,
        username    TEXT,
        color       TEXT,
        captured_at BIGINT,
        PRIMARY KEY (row, col),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    // Tile event history (full audit trail)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tile_events (
        id          SERIAL PRIMARY KEY,
        row         INTEGER NOT NULL,
        col         INTEGER NOT NULL,
        user_id     TEXT NOT NULL,
        username    TEXT NOT NULL,
        event_type  TEXT NOT NULL CHECK(event_type IN ('capture','recapture','expire')),
        timestamp   BIGINT NOT NULL
      );
    `);

    // Indexes for common queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tile_events_user   ON tile_events(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tile_events_ts     ON tile_events(timestamp DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tile_ownership_uid ON tile_ownership(user_id);`);

    await client.query('COMMIT');
    logger.info('PostgresDb', 'Database schema initialized successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('PostgresDb', 'Schema bootstrap failed', { err: err.message });
    throw err;
  } finally {
    client.release();
  }
}

// Fire schema setup asynchronously on module load
bootstrapSchema().catch((err) => {
  logger.error('PostgresDb', 'Failed to bootstrap database on startup', { err: err.message });
});

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Upsert a user record.
 * @param {{ id, username, color, created_at, last_seen, total_captured, current_tiles }} user
 */
async function upsertUser(user) {
  const query = `
    INSERT INTO users (id, username, color, created_at, last_seen, total_captured, current_tiles)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT(id) DO UPDATE SET
      username       = EXCLUDED.username,
      color          = EXCLUDED.color,
      last_seen      = EXCLUDED.last_seen,
      total_captured = EXCLUDED.total_captured,
      current_tiles  = EXCLUDED.current_tiles
  `;
  try {
    await pool.query(query, [
      user.id,
      user.username,
      user.color,
      user.created_at,
      user.last_seen,
      user.total_captured,
      user.current_tiles,
    ]);
  } catch (err) {
    logger.error('PostgresDb', 'upsertUser failed', { err: err.message });
  }
}

/**
 * Persist a tile capture.
 * @param {number} row
 * @param {number} col
 * @param {{ userId, username, color, capturedAt }} owner
 */
async function upsertTile(row, col, owner) {
  const query = `
    INSERT INTO tile_ownership (row, col, user_id, username, color, captured_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(row, col) DO UPDATE SET
      user_id     = EXCLUDED.user_id,
      username    = EXCLUDED.username,
      color       = EXCLUDED.color,
      captured_at = EXCLUDED.captured_at
  `;
  try {
    await pool.query(query, [
      row,
      col,
      owner.userId,
      owner.username,
      owner.color,
      owner.capturedAt,
    ]);
  } catch (err) {
    logger.error('PostgresDb', 'upsertTile failed', { err: err.message });
  }
}

/** Remove a tile from the ownership table (decay/expiry). */
async function clearTile(row, col) {
  const query = `
    UPDATE tile_ownership
    SET user_id = NULL, username = NULL, color = NULL, captured_at = NULL
    WHERE row = $1 AND col = $2
  `;
  try {
    await pool.query(query, [row, col]);
  } catch (err) {
    logger.error('PostgresDb', 'clearTile failed', { err: err.message });
  }
}

/**
 * Record a tile event in the audit log.
 * @param {number} row
 * @param {number} col
 * @param {{ userId, username }} actor
 * @param {'capture'|'recapture'|'expire'} eventType
 */
async function recordEvent(row, col, actor, eventType) {
  const query = `
    INSERT INTO tile_events (row, col, user_id, username, event_type, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  try {
    await pool.query(query, [
      row,
      col,
      actor.userId,
      actor.username,
      eventType,
      Date.now(),
    ]);
  } catch (err) {
    logger.error('PostgresDb', 'recordEvent failed', { err: err.message });
  }
}

/**
 * Load all owned tiles from Postgres (used on server restart).
 * @returns {Promise<Array<{row, col, user_id, username, color, captured_at}>>}
 */
async function loadAllTiles() {
  const query = `
    SELECT row, col, user_id, username, color, captured_at
    FROM tile_ownership
    WHERE user_id IS NOT NULL
  `;
  try {
    const res = await pool.query(query);
    return res.rows.map((r) => ({
      row:         r.row,
      col:         r.col,
      user_id:     r.user_id,
      username:    r.username,
      color:       r.color,
      captured_at: r.captured_at ? parseInt(r.captured_at, 10) : null,
    }));
  } catch (err) {
    logger.error('PostgresDb', 'loadAllTiles failed', { err: err.message });
    return [];
  }
}

/**
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getLeaderboard(limit = 20) {
  const query = `
    SELECT id, username, color, total_captured, current_tiles
    FROM users
    ORDER BY current_tiles DESC, total_captured DESC
    LIMIT $1
  `;
  try {
    const res = await pool.query(query, [limit]);
    return res.rows;
  } catch (err) {
    logger.error('PostgresDb', 'getLeaderboard failed', { err: err.message });
    return [];
  }
}

/**
 * @returns {Promise<Object>} global stats
 */
async function getStats() {
  const since = Date.now() - 60_000; // last 60 seconds
  const query = `
    SELECT
      (SELECT COUNT(*) FROM tile_ownership WHERE user_id IS NOT NULL) AS claimed_tiles,
      (SELECT COUNT(*) FROM users)                                    AS total_users,
      (SELECT COUNT(*) FROM tile_events)                             AS total_events,
      (SELECT COUNT(*) FROM tile_events WHERE timestamp > $1)        AS recent_events
  `;
  try {
    const res = await pool.query(query, [since]);
    const row = res.rows[0] || {};
    return {
      claimed_tiles: parseInt(row.claimed_tiles || 0, 10),
      total_users:   parseInt(row.total_users || 0, 10),
      total_events:  parseInt(row.total_events || 0, 10),
      recent_events: parseInt(row.recent_events || 0, 10),
    };
  } catch (err) {
    logger.error('PostgresDb', 'getStats failed', { err: err.message });
    return null;
  }
}

/**
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getRecentEvents(limit = 50) {
  const query = `
    SELECT row, col, username, event_type, timestamp
    FROM tile_events
    ORDER BY timestamp DESC
    LIMIT $1
  `;
  try {
    const res = await pool.query(query, [limit]);
    return res.rows.map((r) => ({
      row:        r.row,
      col:        r.col,
      username:   r.username,
      event_type: r.event_type,
      timestamp:  r.timestamp ? parseInt(r.timestamp, 10) : null,
    }));
  } catch (err) {
    logger.error('PostgresDb', 'getRecentEvents failed', { err: err.message });
    return [];
  }
}

/**
 * Batch-update user tile counts (called periodically).
 * @param {{ id, username, color, current_tiles, total_captured, last_seen }[]} users
 */
async function batchUpdateUsers(users) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO users (id, username, color, created_at, last_seen, total_captured, current_tiles)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(id) DO UPDATE SET
        username       = EXCLUDED.username,
        color          = EXCLUDED.color,
        last_seen      = EXCLUDED.last_seen,
        total_captured = EXCLUDED.total_captured,
        current_tiles  = EXCLUDED.current_tiles
    `;
    for (const u of users) {
      await client.query(query, [
        u.id || u.userId,
        u.username,
        u.color,
        u.connectedAt || Date.now(),
        u.lastSeen    || Date.now(),
        u.totalCaptured || 0,
        u.currentTiles  || 0,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('PostgresDb', 'batchUpdateUsers failed', { err: err.message });
  } finally {
    client.release();
  }
}

module.exports = {
  upsertUser,
  upsertTile,
  clearTile,
  recordEvent,
  loadAllTiles,
  getLeaderboard,
  getStats,
  getRecentEvents,
  batchUpdateUsers,
  pool,
};
