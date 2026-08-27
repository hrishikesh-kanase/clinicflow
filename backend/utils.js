const crypto = require('crypto');

function uid(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function now() {
  return Date.now();
}

const DAY_MS = 86400000;

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysUntil(iso) {
  return Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / DAY_MS);
}

module.exports = { uid, now, pad, todayISO, addDays, daysUntil, DAY_MS };
