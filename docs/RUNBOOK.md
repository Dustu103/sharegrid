# Developer Runbook & Local Setup Guide

This document is the onboarding manual for setting up your local environment, running the services, and maintaining coding style guidelines.

---

## 1. Local Environment Configuration

To run the backend, you must define the local environment settings. 

Create a `.env` file inside the `backend/` directory:
```env
# ── Server Config ───────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development

# ── Cloud Persistence (Copy from Neon Console) ──────────────────────────────
DATABASE_URL=postgresql://neondb_owner:YOUR_SECRET@ep-green-glitter.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

# ── Logger Level: debug | info | warn | error ───────────────────────────────
LOG_LEVEL=debug

# ── Game Board Spatial Rules ────────────────────────────────────────────────
GRID_ROWS=40
GRID_COLS=50

# ── Action Cooldowns and Transaction Locks ──────────────────────────────────
USER_COOLDOWN_MS=3000
TILE_LOCK_MS=1000
```

---

## 2. Running the Services Locally

Since the root monorepo workspace has been dissolved, `/frontend` and `/backend` exist as completely independent projects. 

You must spin them up inside their respective directories:

### Step 2.1: Launch the Backend Server
Open a terminal window and run:
```bash
# Navigate to backend
cd backend

# Install dependencies (only required on first setup)
npm install

# Run backend development server (with nodemon hot-reload)
npm run dev
```

### Step 2.2: Launch the Frontend Web Server
Open a second terminal window and run:
```bash
# Navigate to frontend
cd frontend

# Install dependencies (only required on first setup)
npm install

# Start lightweight static development server
npm run dev
```

The terminal will print your local hosting URL (e.g., `http://localhost:5173`). Open this URL in your web browser to play the game locally!

---

## 3. Engineering & Coding Conventions

To maintain a clean codebase, every developer must adhere to these structural guidelines:

### 3.1 Non-Blocking Database Queries
To ensure sub-2ms WebSocket execution, all database writes must run as **asynchronous, fire-and-forget tasks**:
*   *Incorrect:* `await db.upsertTile(...)` inside a critical WebSocket frame logic path.
*   *Correct:* `db.upsertTile(...)` (invoked without `await` to let it run in the background).
*   Any query fetching data that the application depends on (e.g., `loadAllTiles()` on boot or REST API routes) **must** use explicit `await` parameters.

### 3.2 Secure Error Handling
Never let a failed database query crash the active Node server. All methods inside `postgresDb.js` must be wrapped in `try/catch` blocks:
```javascript
async function executeQuery() {
  try {
    await pool.query(query, params);
  } catch (err) {
    logger.error('PostgresDb', 'Query failed safely', { err: err.message });
  }
}
```

### 3.3 HTML Sanitization & SQL Protection
*   **HTML Safety:** All user-supplied strings displayed on the canvas or board feed must be passed through `sanitise()` (which strips out HTML-breaking tags like `<>&"'`).
*   **SQL Safety:** Never use string concatenation inside SQL query templates. Always pass parameters via numbered placeholders (`$1, $2, $3`) to completely block SQL Injection threats.
