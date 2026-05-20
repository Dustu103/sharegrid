/**
 * api.js — REST API routes
 * Mounted at /api by server.js
 *
 * All routes are read-only (GET). State mutations happen via WebSocket only.
 */

const express = require('express');
const router  = express.Router();
const store   = require('../data/store');
const db      = require('../data/postgresDb');
const RULES   = require('../game/rules');

/**
 * GET /api/grid
 * Returns the full live grid snapshot.
 * Clients use this as a fallback if WS initial state was lost.
 */
router.get('/grid', (_req, res) => {
  res.json({
    ok: true,
    grid: store.getAllTiles(),
    rows: RULES.GRID_ROWS,
    cols: RULES.GRID_COLS,
    timestamp: Date.now(),
  });
});

/**
 * GET /api/leaderboard
 * Top-N users by current tiles owned (live in-memory data).
 */
router.get('/leaderboard', (_req, res) => {
  const limit = Math.min(Number(_req.query.limit) || 20, 100);
  res.json({
    ok: true,
    leaderboard: store.getLeaderboard(limit),
    timestamp: Date.now(),
  });
});

/**
 * GET /api/stats
 * Global game statistics.
 */
router.get('/stats', async (_req, res) => {
  const dbStats   = await db.getStats();
  const onlineNow = store.getAllUsers().length;
  const tiles     = store.getAllTiles();
  const claimed   = Object.keys(tiles).length;

  res.json({
    ok: true,
    stats: {
      onlineNow,
      claimedTiles:  claimed,
      totalTiles:    RULES.TOTAL_TILES,
      percentClaimed: ((claimed / RULES.TOTAL_TILES) * 100).toFixed(1),
      totalEvents:   dbStats?.total_events  ?? 0,
      recentEvents:  dbStats?.recent_events ?? 0,
      totalUsers:    dbStats?.total_users   ?? 0,
    },
    timestamp: Date.now(),
  });
});

/**
 * GET /api/history?limit=50
 * Recent tile capture events.
 */
router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({
    ok: true,
    events: await db.getRecentEvents(limit),
    timestamp: Date.now(),
  });
});

/**
 * GET /api/users
 * Currently online users.
 */
router.get('/users', (_req, res) => {
  res.json({
    ok: true,
    users: store.getAllUsers(),
    count: store.getAllUsers().length,
    timestamp: Date.now(),
  });
});

/**
 * GET /health
 * Liveness probe for load balancers / uptime monitors.
 */
router.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ts: Date.now() });
});

module.exports = router;
