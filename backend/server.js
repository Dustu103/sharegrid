/**
 * server.js — Application entry point
 *
 * Startup order:
 *   1. Load env
 *   2. Create Express + HTTP server
 *   3. Restore grid state from SQLite
 *   4. Attach WebSocket server
 *   5. Listen
 */

// Load .env from the backend/ directory regardless of cwd
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const logger      = require('./utils/logger');
const engine      = require('./game/gameEngine');
const wsServer    = require('./ws/wsServer');
const redisClient = require('./data/redisClient');
const apiRoutes   = require('./routes/api');

// ── Express setup ─────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10kb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// REST API
app.use('/api', apiRoutes);

// Catch-all: serve frontend SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── HTTP Server ───────────────────────────────────────────────────────────
const PORT   = parseInt(process.env.PORT) || 3001;
const server = http.createServer(app);

// ── Startup sequence ──────────────────────────────────────────────────────
(async function start() {
  logger.info('Server', '── ShareGrid starting ──');

  // Connect to Redis (non-blocking — app works without it)
  await redisClient.connect();

  // Restore persisted grid state from SQLite
  engine.restoreGridFromDb();

  // Attach WebSocket (Redis clients injected inside)
  wsServer.attach(server);

  // Start listening
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    logger.info('Server', `Listening on port ${PORT}`, {
      url: `http://${HOST}:${PORT}`,
      env: process.env.NODE_ENV || 'development',
    });
  });

  server.on('error', (err) => {
    logger.error('Server', 'HTTP server error', { err: err.message });
    process.exit(1);
  });
})();

// ── Graceful shutdown ─────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('Server', 'Uncaught exception', { err: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Server', 'Unhandled rejection', { reason: String(reason) });
});
