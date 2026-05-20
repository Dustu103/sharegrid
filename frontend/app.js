/**
 * app.js — ShareGrid Frontend Client
 * Connects via WebSocket, renders the tile grid on Canvas, handles user input.
 */

// ── Constants ─────────────────────────────────────────────────────────────────
// Change 'your-backend-app.onrender.com' to your actual Render backend URL after deploying!
const IS_DEV    = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const WS_URL    = IS_DEV 
  ? `ws://${location.hostname}:3001` 
  : `wss://sharegrid-ffxr.onrender.com`;
const TILE_SIZE = 14;   // px per tile at zoom=1
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

// ── Sound Synthesizer (Web Audio API) ──────────────────────────────────────────
const SoundManager = {
  ctx: null,
  isMuted: localStorage.getItem('sg_muted') === 'true',

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      this.ctx = new AudioContextClass();
    }
  },

  toggle() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('sg_muted', this.isMuted);
    return this.isMuted;
  },

  playSuccess() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.08); // A5
    
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  },

  playError() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(130, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(85, this.ctx.currentTime + 0.15);
    
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.16);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.16);
  },

  playAlert() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime); // A4
    osc.frequency.setValueAtTime(659.25, this.ctx.currentTime + 0.05); // E5
    
    gain.gain.setValueAtTime(0.03, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.18);
  }
};

const COLOR_PALETTE = [
  '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e63','#00bcd4','#8bc34a',
  '#ff5722','#607d8b','#ff9800','#4caf50','#2196f3',
  '#9c27b0','#f06292','#26c6da','#d4e157','#ff7043',
];

// ── State ─────────────────────────────────────────────────────────────────────
let ws            = null;
let reconnectIdx  = 0;
let userId        = localStorage.getItem('sg_userId') || null;
let myUsername    = '';
let myColor       = COLOR_PALETTE[0];
let selectedColor = COLOR_PALETTE[0];
let gridRows      = 40;
let gridCols      = 50;
let cooldownMs    = 3000;
let cooldownUntil = 0;
let cooldownRAF   = null;
let tileGrid      = {};   // key "row:col" → tile data
let users         = {};   // userId → user data
let leaderboard   = [];

// Camera / zoom / pan
let zoom      = 1;
let panX      = 0;
let panY      = 0;
let isPanning = false;
let lastPan   = { x: 0, y: 0 };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const joinOverlay    = document.getElementById('join-overlay');
const joinBtn        = document.getElementById('join-btn');
const usernameInput  = document.getElementById('username-input');
const colorSwatch    = document.getElementById('color-preview-swatch');
const colorLabel     = document.getElementById('color-preview-label');
const appEl          = document.getElementById('app');
const canvas         = document.getElementById('grid-canvas');
const ctx            = canvas.getContext('2d');
const minimapCanvas  = document.getElementById('minimap-canvas');
const mctx           = minimapCanvas.getContext('2d');
const minimapVP      = document.getElementById('minimap-viewport');
const toastCont      = document.getElementById('toast-container');
const cooldownWrap   = document.getElementById('cooldown-bar-wrap');
const cooldownBar    = document.getElementById('cooldown-bar');
const cooldownLbl    = document.getElementById('cooldown-label');
const connBadge      = document.getElementById('conn-badge');
const connLabel      = document.getElementById('conn-label');
const hdrOnline      = document.getElementById('hdr-online');
const hdrClaimed     = document.getElementById('hdr-claimed');
const hdrPing        = document.getElementById('hdr-ping');
const hdrColor       = document.getElementById('hdr-color');
const hdrUsername    = document.getElementById('hdr-username');
const hdrTiles       = document.getElementById('hdr-tiles');
const statOnline     = document.getElementById('stat-online');
const statTiles      = document.getElementById('stat-tiles');
const lbList         = document.getElementById('leaderboard-list');
const feedList       = document.getElementById('feed-list');
const playersGrid    = document.getElementById('players-grid');
const onlineBadge    = document.getElementById('online-badge');
const myTilesCount   = document.getElementById('my-tiles-count');
const myTotal        = document.getElementById('my-total-captured');
const myCurrent      = document.getElementById('my-current-tiles');
const myBoardPct     = document.getElementById('my-board-pct');
const ringFill       = document.getElementById('ring-fill');
const reconnectOvl   = document.getElementById('reconnect-overlay');
const zoomInBtn      = document.getElementById('zoom-in-btn');
const zoomOutBtn     = document.getElementById('zoom-out-btn');
const zoomResetBtn   = document.getElementById('zoom-reset-btn');
const zoomLevelEl    = document.getElementById('zoom-level');
const tileTooltip    = document.getElementById('tile-tooltip');
const audioToggleBtn = document.getElementById('audio-toggle-btn');

// Set initial audio toggle state
audioToggleBtn.textContent = SoundManager.isMuted ? '🔇' : '🔊';
audioToggleBtn.title = SoundManager.isMuted ? 'Unmute Audio' : 'Mute Audio';

// ── Color Picker (injected into modal) ────────────────────────────────────────
function buildColorPicker() {
  const formGroup = document.querySelector('.form-group');
  const picker = document.createElement('div');
  picker.className = 'color-picker-section';
  picker.innerHTML = `<label>Pick Your Color</label><div class="color-palette" id="color-palette"></div>`;
  formGroup.parentNode.insertBefore(picker, formGroup.nextSibling);

  const palette = document.getElementById('color-palette');
  COLOR_PALETTE.forEach(hex => {
    const swatch = document.createElement('button');
    swatch.className = 'palette-swatch';
    swatch.style.background = hex;
    swatch.dataset.color = hex;
    swatch.title = hex;
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = hex;
      colorSwatch.style.background = hex;
      colorLabel.textContent = hex;
    });
    palette.appendChild(swatch);
  });

  // Select first
  palette.querySelector('.palette-swatch').classList.add('selected');
  colorSwatch.style.background = COLOR_PALETTE[0];
  colorLabel.textContent = COLOR_PALETTE[0];
}

// ── Join form validation ───────────────────────────────────────────────────────
usernameInput.addEventListener('input', () => {
  const val = usernameInput.value.trim();
  joinBtn.disabled = val.length < 2;
});

joinBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  if (username.length < 2) return;
  myUsername = username;
  myColor    = selectedColor;
  if (!userId) userId = crypto.randomUUID();
  localStorage.setItem('sg_userId', userId);
  connectWS();
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
async function connectWS() {
  setConnStatus('connecting');

  let targetUrl = WS_URL;
  let loaded = false;

  // 1. Try fetching from Vercel Serverless Config API (production env validation)
  try {
    const apiRes = await fetch('/api/config');
    if (apiRes.ok) {
      const apiCfg = await apiRes.json();
      if (apiCfg.WS_URL) {
        targetUrl = apiCfg.WS_URL;
        loaded = true;
        console.log('Using WebSocket URL from Vercel environment:', targetUrl);
      }
    }
  } catch (err) {
    // Network error or local client running without proxy support
  }

  // 2. If Vercel env is not loaded, try fetching from local env.json override (local development)
  if (!loaded) {
    try {
      const localRes = await fetch('env.json');
      if (localRes.ok) {
        const localCfg = await localRes.json();
        if (localCfg.WS_URL) {
          targetUrl = localCfg.WS_URL;
          loaded = true;
          console.log('Using WebSocket override URL from env.json:', targetUrl);
        }
      }
    } catch (err) {
      // Local config file not found (normal in clean environments)
    }
  }

  ws = new WebSocket(targetUrl);

  ws.onopen = () => {
    reconnectIdx = 0;
    reconnectOvl.classList.add('hidden');
    send('JOIN', { userId, username: myUsername, color: myColor });
  };

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    setConnStatus('offline');
    scheduleReconnect();
  };

  ws.onerror = () => ws.close();
}

function send(type, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function scheduleReconnect() {
  const delay = RECONNECT_DELAYS[Math.min(reconnectIdx++, RECONNECT_DELAYS.length - 1)];
  reconnectOvl.classList.remove('hidden');
  setTimeout(connectWS, delay);
}

// ── Message handlers ──────────────────────────────────────────────────────────
const pingTs = { sent: 0 };
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    pingTs.sent = Date.now();
    send('PING');
  }
}, 5000);

function handleMessage(msg) {
  switch (msg.type) {
    case 'WELCOME':       return onWelcome(msg);
    case 'TILE_UPDATED':  return onTileUpdated(msg);
    case 'TILE_REJECTED': return onTileRejected(msg);
    case 'USER_JOINED':   return onUserJoined(msg);
    case 'USER_LEFT':     return onUserLeft(msg);
    case 'PONG':          return onPong();
    case 'ERROR':         return showToast(msg.message || 'Server error', 'error');
  }
}

function onWelcome(msg) {
  myColor = msg.color;
  gridRows = msg.rules.gridRows;
  gridCols = msg.rules.gridCols;
  cooldownMs = msg.rules.cooldownMs;

  // Rebuild grid from state
  tileGrid = {};
  for (const [key, tile] of Object.entries(msg.gridState || {})) {
    tileGrid[key] = tile;
  }

  users = {};
  for (const u of (msg.onlineUsers || [])) {
    users[u.userId] = u;
  }

  setConnStatus('online');
  showApp();
  renderAll();
  updateLeaderboard(null);
  updatePlayersList();
  updateMyStats();
  updateHeaderStats();
  centreView();
}

function onTileUpdated(msg) {
  const key = `${msg.row}:${msg.col}`;
  const isMe = msg.owner.userId === userId;
  tileGrid[key] = msg.owner;
  if (msg.leaderboard) updateLeaderboard(msg.leaderboard);
  addFeedItem(msg);
  renderAll();
  updateMyStats();
  updateHeaderStats();

  if (!isMe) {
    SoundManager.playAlert();
  }
}

function onTileRejected(msg) {
  SoundManager.playError();
  if (msg.reason === 'COOLDOWN_ACTIVE') startCooldown(msg.cooldownMs);
  else if (msg.reason === 'RATE_LIMITED') showToast('Slow down!', 'warn');
  else if (msg.reason === 'TILE_LOCKED')  showToast('Tile locked!', 'warn');
}

function onUserJoined(msg) {
  users[msg.userId] = msg;
  updatePlayersList();
  updateHeaderStats();
  showToast(`${msg.username} joined`, 'info');
}

function onUserLeft(msg) {
  delete users[msg.userId];
  updatePlayersList();
  updateHeaderStats();
}

function onPong() {
  const ping = Date.now() - pingTs.sent;
  hdrPing.textContent = ping;
}

// ── Show app / hide modal ─────────────────────────────────────────────────────
function showApp() {
  joinOverlay.classList.remove('active');
  appEl.classList.remove('hidden');
  hdrUsername.textContent = myUsername;
  hdrColor.style.background = myColor;
  resizeCanvas();
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  canvas.width  = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  renderGrid();
  renderMinimap();
}

window.addEventListener('resize', resizeCanvas);

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderAll() {
  renderGrid();
  renderMinimap();
  updateMinimapViewport();
}

function renderGrid() {
  const tileW = TILE_SIZE * zoom;
  const tileH = TILE_SIZE * zoom;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;

  const startCol = Math.max(0, Math.floor(-panX / tileW));
  const startRow = Math.max(0, Math.floor(-panY / tileH));
  const endCol   = Math.min(gridCols, startCol + Math.ceil(canvas.width  / tileW) + 1);
  const endRow   = Math.min(gridRows, startRow + Math.ceil(canvas.height / tileH) + 1);

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const x = panX + c * tileW;
      const y = panY + r * tileH;
      const tile = tileGrid[`${r}:${c}`];

      if (tile) {
        ctx.fillStyle = tile.color;
        ctx.fillRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);

        // Highlight own tiles
        if (tile.userId === userId) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1, y + 1, tileW - 2, tileH - 2);
        }
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, tileW, tileH);
      }
    }
  }
}

function renderMinimap() {
  const mW = minimapCanvas.width  = minimapCanvas.offsetWidth;
  const mH = minimapCanvas.height = minimapCanvas.offsetHeight;
  const tW = mW / gridCols;
  const tH = mH / gridRows;

  mctx.fillStyle = '#0d1117';
  mctx.fillRect(0, 0, mW, mH);

  for (const [key, tile] of Object.entries(tileGrid)) {
    const [r, c] = key.split(':').map(Number);
    mctx.fillStyle = tile.color;
    mctx.fillRect(c * tW, r * tH, Math.max(1, tW), Math.max(1, tH));
  }
}

function updateMinimapViewport() {
  const mW = minimapCanvas.offsetWidth;
  const mH = minimapCanvas.offsetHeight;
  const tileW = TILE_SIZE * zoom;
  const tileH = TILE_SIZE * zoom;
  const totalW = gridCols * tileW;
  const totalH = gridRows * tileH;

  const vpL = Math.max(0, (-panX / totalW) * mW);
  const vpT = Math.max(0, (-panY / totalH) * mH);
  const vpW = Math.min(mW, (canvas.width  / totalW) * mW);
  const vpH = Math.min(mH, (canvas.height / totalH) * mH);

  minimapVP.style.left   = vpL + 'px';
  minimapVP.style.top    = vpT + 'px';
  minimapVP.style.width  = vpW + 'px';
  minimapVP.style.height = vpH + 'px';
}

function centreView() {
  const totalW = gridCols * TILE_SIZE * zoom;
  const totalH = gridRows * TILE_SIZE * zoom;
  panX = (canvas.width  - totalW) / 2;
  panY = (canvas.height - totalH) / 2;
  renderAll();
}

// ── Input: click to claim ─────────────────────────────────────────────────────
canvas.addEventListener('click', e => {
  if (isPanning) return;
  const tileW = TILE_SIZE * zoom;
  const tileH = TILE_SIZE * zoom;
  const col = Math.floor((e.offsetX - panX) / tileW);
  const row = Math.floor((e.offsetY - panY) / tileH);
  if (row < 0 || row >= gridRows || col < 0 || col >= gridCols) return;
  if (Date.now() < cooldownUntil) { 
    showToast('Still on cooldown!', 'warn'); 
    SoundManager.playError();
    return; 
  }
  send('CLAIM_TILE', { row, col });
  startCooldown(cooldownMs);
  SoundManager.playSuccess();
});

// ── Hover tooltip ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  if (isPanning) { tileTooltip.style.display = 'none'; return; }
  const tileW = TILE_SIZE * zoom;
  const tileH = TILE_SIZE * zoom;
  const col = Math.floor((e.offsetX - panX) / tileW);
  const row = Math.floor((e.offsetY - panY) / tileH);
  if (row < 0 || row >= gridRows || col < 0 || col >= gridCols) {
    tileTooltip.style.display = 'none'; return;
  }
  const tile = tileGrid[`${row}:${col}`];
  tileTooltip.style.display = 'block';
  tileTooltip.style.left = (e.offsetX + 12) + 'px';
  tileTooltip.style.top  = (e.offsetY + 12) + 'px';
  tileTooltip.innerHTML  = tile
    ? `<strong style="color:${tile.color}">${tile.username}</strong><br>[${row}, ${col}]`
    : `Empty [${row}, ${col}]`;
});
canvas.addEventListener('mouseleave', () => { tileTooltip.style.display = 'none'; });

// ── Pan (right-click drag or middle-click drag) ───────────────────────────────
canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || e.button === 2) {
    isPanning = true;
    lastPan = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  }
});
window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  panX += e.clientX - lastPan.x;
  panY += e.clientY - lastPan.y;
  lastPan = { x: e.clientX, y: e.clientY };
  renderAll();
});
window.addEventListener('mouseup', e => {
  if (e.button === 1 || e.button === 2) {
    isPanning = false;
    canvas.style.cursor = 'crosshair';
  }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Zoom ──────────────────────────────────────────────────────────────────────
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const delta  = e.deltaY > 0 ? -0.1 : 0.1;
  const newZ   = Math.max(0.3, Math.min(4, zoom + delta));
  const scale  = newZ / zoom;
  panX = e.offsetX - scale * (e.offsetX - panX);
  panY = e.offsetY - scale * (e.offsetY - panY);
  zoom = newZ;
  zoomLevelEl.textContent = Math.round(zoom * 100) + '%';
  renderAll();
}, { passive: false });

zoomInBtn.addEventListener('click',    () => adjustZoom(0.2));
zoomOutBtn.addEventListener('click',   () => adjustZoom(-0.2));
zoomResetBtn.addEventListener('click', () => { zoom = 1; centreView(); zoomLevelEl.textContent = '100%'; });
audioToggleBtn.addEventListener('click', () => {
  const isMuted = SoundManager.toggle();
  audioToggleBtn.textContent = isMuted ? '🔇' : '🔊';
  audioToggleBtn.title = isMuted ? 'Unmute Audio' : 'Mute Audio';
});

function adjustZoom(delta) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const newZ = Math.max(0.3, Math.min(4, zoom + delta));
  const scale = newZ / zoom;
  panX = cx - scale * (cx - panX);
  panY = cy - scale * (cy - panY);
  zoom = newZ;
  zoomLevelEl.textContent = Math.round(zoom * 100) + '%';
  renderAll();
}

// ── Cooldown bar ──────────────────────────────────────────────────────────────
function startCooldown(ms) {
  cooldownUntil = Date.now() + ms;
  if (cooldownRAF) cancelAnimationFrame(cooldownRAF);
  animateCooldown();
}

function animateCooldown() {
  const remaining = cooldownUntil - Date.now();
  if (remaining <= 0) {
    cooldownBar.style.width = '100%';
    cooldownLbl.textContent = 'Ready!';
    cooldownWrap.classList.remove('active');
    return;
  }
  cooldownWrap.classList.add('active');
  const pct = (1 - remaining / cooldownMs) * 100;
  cooldownBar.style.width = pct + '%';
  cooldownLbl.textContent = (remaining / 1000).toFixed(1) + 's';
  cooldownRAF = requestAnimationFrame(animateCooldown);
}

// ── UI updates ────────────────────────────────────────────────────────────────
function updateHeaderStats() {
  hdrOnline.textContent  = Object.keys(users).length;
  hdrClaimed.textContent = Object.keys(tileGrid).length;
  statOnline.textContent = Object.keys(users).length;
  statTiles.textContent  = Object.keys(tileGrid).length;
}

function updateMyStats() {
  const myTiles = Object.values(tileGrid).filter(t => t.userId === userId);
  const total   = gridRows * gridCols;
  const count   = myTiles.length;
  const pct     = ((count / total) * 100).toFixed(1);
  myTilesCount.textContent = count;
  myCurrent.textContent    = count;
  myBoardPct.textContent   = pct + '%';
  hdrTiles.textContent     = count + ' tiles';

  // Ring
  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (count / Math.min(total, 500)) * circumference;
  ringFill.style.strokeDasharray  = `${circumference}`;
  ringFill.style.strokeDashoffset = `${Math.max(0, offset)}`;
  ringFill.style.stroke = myColor;
}

function updateLeaderboard(lb) {
  if (lb) leaderboard = lb;
  if (!leaderboard.length) {
    lbList.innerHTML = '<li class="lb-placeholder">No data yet…</li>';
    return;
  }
  lbList.innerHTML = leaderboard.slice(0, 10).map((u, i) => `
    <li class="lb-row ${u.userId === userId ? 'lb-me' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-dot" style="background:${u.color}"></span>
      <span class="lb-name">${escHtml(u.username)}</span>
      <span class="lb-score">${u.currentTiles}</span>
    </li>`).join('');
}

function updatePlayersList() {
  const list = Object.values(users);
  onlineBadge.textContent = list.length;
  playersGrid.innerHTML = list.map(u => `
    <div class="player-chip" title="${escHtml(u.username)}">
      <span class="player-dot" style="background:${u.color}"></span>
      <span>${escHtml(u.username)}</span>
    </div>`).join('');
}

function addFeedItem(msg) {
  const tile = msg.owner;
  if (!tile) return;
  const li = document.createElement('li');
  li.className = 'feed-item';
  li.innerHTML = `
    <span class="feed-dot" style="background:${tile.color}"></span>
    <span class="feed-text"><strong>${escHtml(tile.username)}</strong> captured [${msg.row},${msg.col}]</span>
    <span class="feed-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`;
  feedList.prepend(li);
  while (feedList.children.length > 50) feedList.lastChild.remove();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  toastCont.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ── Connection status ─────────────────────────────────────────────────────────
function setConnStatus(state) {
  connBadge.className = `connection-badge ${state}`;
  connLabel.textContent = { online: 'Connected', connecting: 'Connecting…', offline: 'Disconnected' }[state] || state;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── Init ──────────────────────────────────────────────────────────────────────
buildColorPicker();

// Prefill last username if saved
const savedName = localStorage.getItem('sg_username');
if (savedName) {
  usernameInput.value = savedName;
  joinBtn.disabled = savedName.length < 2;
}
usernameInput.addEventListener('change', () => localStorage.setItem('sg_username', usernameInput.value.trim()));
