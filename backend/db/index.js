const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || './storage/data/clinicflow.db';
const resolved = path.resolve(__dirname, '..', DB_FILE.replace(/^\.\//, ''));
fs.mkdirSync(path.dirname(resolved), { recursive: true });

const db = new Database(resolved);
// DELETE (not WAL) — some cloud volume filesystems (e.g. Railway) don't
// support the shared-memory mapping WAL mode needs, which crashes the
// native SQLite engine. DELETE mode is slightly slower under heavy
// concurrent writes but works everywhere and is plenty fast for this app.
db.pragma('journal_mode = DELETE');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
