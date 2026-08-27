// Wipes the SQLite database file and rebuilds it from schema + seed.
// Usage: npm run seed:reset
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_FILE || './storage/data/clinicflow.db';
const resolved = path.resolve(__dirname, '..', DB_FILE.replace(/^\.\//, ''));

for (const suffix of ['', '-wal', '-shm']) {
  const f = resolved + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
console.log('Old database removed. Rebuilding...');

// Re-require after deletion so db/index.js creates a fresh file.
const seed = require('./seed');
seed();
console.log('Database reset complete:', resolved);
