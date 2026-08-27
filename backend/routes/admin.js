const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const S = require('../db/serialize');
const { uid, now, todayISO, daysUntil } = require('../utils');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function audit(user, action, ref) {
  db.prepare('INSERT INTO audit (id,user,action,ref,at) VALUES (?,?,?,?,?)').run(uid('L'), user, action, ref, now());
}
function invQty(name) {
  return db.prepare('SELECT COALESCE(SUM(qty),0) q FROM inventory WHERE name = ?').get(name).q;
}
function nearExpiryDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'nearExpiryDays'").get();
  return row ? Number(row.value) : 60;
}

// ---- Dashboard --------------------------------------------------------
router.get('/dashboard', requireRole('admin'), (req, res) => {
  const t = todayISO();
  const paidToday = db.prepare("SELECT * FROM bills WHERE status = 'Paid' AND paid_at IS NOT NULL").all()
    .filter(b => new Date(b.paid_at).toISOString().slice(0, 10) === t);
  const collection = paidToday.reduce((s, b) => s + b.total, 0);
  const outstanding = db.prepare("SELECT COALESCE(SUM(total),0) s FROM bills WHERE status = 'Pending'").get().s;
  const footfall = db.prepare('SELECT * FROM appointments WHERE date = ?').all(t);

  const purposes = ['Skin Issue', 'Hair Issue', 'Treatment', 'Others'];
  const byPurpose = {};
  purposes.forEach(p => { byPurpose[p] = footfall.filter(a => a.purpose === p).length; });

  const distinctNames = db.prepare('SELECT DISTINCT name, reorder FROM inventory').all();
  const nameReorder = {};
  db.prepare('SELECT name, MIN(reorder) reorder FROM inventory GROUP BY name').all().forEach(r => { nameReorder[r.name] = r.reorder; });
  const lowStock = Object.keys(nameReorder).filter(n => invQty(n) <= nameReorder[n]);

  const near = nearExpiryDays();
  const nearExp = db.prepare('SELECT * FROM inventory').all().filter(i => daysUntil(i.expiry) <= near).map(S.inventory);

  res.json({
    date: t,
    collectionToday: collection,
    footfallToday: footfall.length,
    outstanding,
    byPurpose,
    lowStock: lowStock.map(n => ({ name: n, qty: invQty(n) })),
    nearExpiry: nearExp,
  });
});

// ---- Users --------------------------------------------------------------
router.get('/users', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY role ASC').all().map(S.user));
});

router.post('/users', requireRole('admin'), (req, res) => {
  const { name, username, password, role } = req.body || {};
  const roles = ['reception', 'doctor', 'pharmacy', 'treatment', 'admin'];
  if (!name || !username || !password || !roles.includes(role)) {
    return res.status(400).json({ error: `name, username, password and a valid role (${roles.join(', ')}) are required.` });
  }
  const uname = String(username).trim().toLowerCase();
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname);
  if (exists) return res.status(409).json({ error: 'That username is already taken.' });
  const u = { id: uid('U'), name: String(name).trim(), username: uname, password_hash: bcrypt.hashSync(password, 10), role, active: 1, created_at: now() };
  db.prepare('INSERT INTO users (id,name,username,password_hash,role,active,created_at) VALUES (@id,@name,@username,@password_hash,@role,@active,@created_at)').run(u);
  audit(req.user.sub, 'Add user', u.id);
  res.status(201).json(S.user(u));
});

router.patch('/users/:id/toggle', requireRole('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);
  audit(req.user.sub, 'Toggle user', u.id);
  res.json(S.user(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

// ---- Settings -------------------------------------------------------------
router.get('/settings', requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

router.put('/settings', requireRole('admin'), (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(req.body || {})) upsert.run(k, String(v));
  audit(req.user.sub, 'Update settings', 'settings');
  const rows = db.prepare('SELECT * FROM settings').all();
  const out = {}; rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

module.exports = router;
