const express = require('express');
const db = require('../db');
const S = require('../db/serialize');
const { uid, now, todayISO, addDays } = require('../utils');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function audit(user, action, ref) {
  db.prepare('INSERT INTO audit (id,user,action,ref,at) VALUES (?,?,?,?,?)').run(uid('L'), user, action, ref, now());
}

// List all batches (doctor needs this to prescribe against live stock; pharmacy/admin manage it)
router.get('/', requireRole('doctor', 'pharmacy', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM inventory ORDER BY name ASC').all().map(S.inventory));
});

// Add a new medicine / batch
router.post('/', requireRole('pharmacy', 'admin'), (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.qty) return res.status(400).json({ error: 'Medicine name and quantity are required.' });
  const it = {
    id: uid('M'), name: String(b.name).trim(), batch: b.batch || '—', expiry: b.expiry || addDays(todayISO(), 365),
    qty: Number(b.qty) || 0, cost: Number(b.cost) || 0, price: Number(b.price) || 0, gst: Number(b.gst) || 0,
    reorder: Number(b.reorder) || 20, supplier: b.supplier || '—',
  };
  db.prepare(`INSERT INTO inventory (id,name,batch,expiry,qty,cost,price,gst,reorder,supplier)
    VALUES (@id,@name,@batch,@expiry,@qty,@cost,@price,@gst,@reorder,@supplier)`).run(it);
  db.prepare('INSERT INTO stock_moves (id,name,batch,type,qty,ref,at) VALUES (?,?,?,?,?,?,?)').run(uid('S'), it.name, it.batch, 'IN', it.qty, 'purchase', now());
  audit(req.user.sub, 'Add inventory', it.id);
  res.status(201).json(S.inventory(it));
});

// Restock an existing batch
router.post('/:id/restock', requireRole('pharmacy', 'admin'), (req, res) => {
  const it = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Batch not found.' });
  const qty = Number(req.body.qty);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0.' });
  db.prepare('UPDATE inventory SET qty = qty + ? WHERE id = ?').run(qty, it.id);
  db.prepare('INSERT INTO stock_moves (id,name,batch,type,qty,ref,at) VALUES (?,?,?,?,?,?,?)').run(uid('S'), it.name, it.batch, 'IN', qty, 'purchase', now());
  audit(req.user.sub, 'Restock', it.id);
  res.json(S.inventory(db.prepare('SELECT * FROM inventory WHERE id = ?').get(it.id)));
});

module.exports = router;
