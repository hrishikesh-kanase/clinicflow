const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { uid, now } = require('../utils');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'storage', 'uploads', 'branding');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `logo-${Date.now()}${ALLOWED[file.mimetype] || ''}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(new Error('Logo must be a PNG, JPG, WEBP or SVG image.'));
    cb(null, true);
  },
});

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function audit(user, action, ref) {
  db.prepare('INSERT INTO audit (id,user,action,ref,at) VALUES (?,?,?,?,?)').run(uid('L'), user, action, ref, now());
}

// Public — the login screen (pre-auth) and topbar both need this.
router.get('/', (req, res) => {
  res.json({ clinicName: getSetting('clinicName') || 'ClinicFlow', logoUrl: getSetting('logoUrl') || '' });
});

router.post('/logo', requireAuth, requireRole('admin'), (req, res) => {
  upload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });

    const old = getSetting('logoUrl');
    if (old) {
      const oldPath = path.join(__dirname, '..', old.replace(/^\/+/, ''));
      if (oldPath.startsWith(UPLOAD_DIR) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    const logoUrl = `/uploads/branding/${req.file.filename}`;
    setSetting('logoUrl', logoUrl);
    audit(req.user.sub, 'Update logo', logoUrl);
    res.json({ logoUrl });
  });
});

router.delete('/logo', requireAuth, requireRole('admin'), (req, res) => {
  const old = getSetting('logoUrl');
  if (old) {
    const oldPath = path.join(__dirname, '..', old.replace(/^\/+/, ''));
    if (oldPath.startsWith(UPLOAD_DIR) && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  setSetting('logoUrl', '');
  audit(req.user.sub, 'Remove logo', '');
  res.json({ logoUrl: '' });
});

module.exports = router;
