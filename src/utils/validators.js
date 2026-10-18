const config = require('../config');

const CHANNEL_RE = /^[a-z0-9_-]{2,30}$/;

// Returns a normalized channel name, or null when invalid.
function normalizeChannel(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  return CHANNEL_RE.test(n) ? n : null;
}

// Returns cleaned message text, or null when empty, too long or not a string.
function cleanText(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (t.length === 0 || t.length > config.maxMessageLength) return null;
  return t;
}

function isUserId(id) {
  return typeof id === 'string' && /^u_[a-z0-9_]{3,20}$/.test(id);
}

module.exports = { normalizeChannel, cleanText, isUserId };
