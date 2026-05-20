/**
 * colorAssigner.js
 * Derives a consistent, vibrant HSL color from a user's UUID.
 * The hue is deterministic (same userId → same color across sessions).
 * Saturation and lightness are fixed for visual consistency.
 */

// Hue values chosen to be visually distinct and avoid near-duplicates
const HUE_SLOTS = [
   0,  20,  40,  60,  80, 100, 120, 140,
 160, 180, 200, 220, 240, 260, 280, 300,
 320, 340, 170, 210, 250, 290, 330, 10,
  50,  90, 130, 170, 350, 30,
];

/**
 * Simple djb2-style hash over the userId string.
 * @param {string} str
 * @returns {number} non-negative integer
 */
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return Math.abs(h >>> 0); // unsigned 32-bit
}

/**
 * Assigns a deterministic CSS color string for a given userId.
 * @param {string} userId - UUID or any string identifier
 * @returns {string} e.g. "hsl(220, 80%, 58%)"
 */
function assignColor(userId) {
  const idx = hashString(userId) % HUE_SLOTS.length;
  const hue = HUE_SLOTS[idx];
  return `hsl(${hue}, 80%, 58%)`;
}

/**
 * Converts an HSL color string to a hex-like CSS representation.
 * (Kept for potential future use in Canvas fillStyle.)
 */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

module.exports = { assignColor, hslToHex, hashString };
