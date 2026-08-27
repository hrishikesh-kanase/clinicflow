const express = require('express');
const db = require('../db');
const S = require('../db/serialize');
const { uid, now } = require('../utils');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function audit(user, action, ref) {
  db.prepare('INSERT INTO audit (id,user,action,ref,at) VALUES (?,?,?,?,?)').run(uid('L'), user, action, ref, now());
}

// List treatments — active ones are needed by doctor & treatment centre; admin sees all
router.get('/', requireRole('doctor', 'treatment', 'admin'), (req, res) => {
  let rows = db.prepare('SELECT * FROM treatments ORDER BY name ASC').all();
  if (req.user.role !== 'admin' && req.query.all !== '1') rows = rows.filter(t => t.active);
  res.json(rows.map(S.treatment));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, cost } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Treatment name is required.' });
  const t = { id: uid('T'), name: String(name).trim(), cost: Number(cost) || 0, active: 1 };
  db.prepare('INSERT INTO treatments (id,name,cost,active) VALUES (@id,@name,@cost,@active)').run(t);
  audit(req.user.sub, 'Add treatment', t.id);
  res.status(201).json(S.treatment(t));
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM treatments WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Treatment not found.' });
  const name = req.body.name ? String(req.body.name).trim() : t.name;
  const cost = req.body.cost != null ? Number(req.body.cost) : t.cost;
  db.prepare('UPDATE treatments SET name = ?, cost = ? WHERE id = ?').run(name, cost, t.id);
  audit(req.user.sub, 'Edit treatment', t.id);
  res.json(S.treatment(db.prepare('SELECT * FROM treatments WHERE id = ?').get(t.id)));
});

router.patch('/:id/toggle', requireRole('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM treatments WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Treatment not found.' });
  db.prepare('UPDATE treatments SET active = ? WHERE id = ?').run(t.active ? 0 : 1, t.id);
  audit(req.user.sub, 'Toggle treatment', t.id);
  res.json(S.treatment(db.prepare('SELECT * FROM treatments WHERE id = ?').get(t.id)));
});

module.exports = router;
