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

// Patients with outstanding (non-pharmacy) dues, grouped
router.get('/due', requireRole('reception', 'admin'), (req, res) => {
  const patientIds = db.prepare("SELECT DISTINCT patient_id FROM bills WHERE status = 'Pending' AND type != 'Pharmacy'").all().map(r => r.patient_id);
  const out = patientIds.map(pid => {
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(pid);
    const bills = db.prepare("SELECT * FROM bills WHERE patient_id = ? AND status = 'Pending' AND type != 'Pharmacy'").all(pid).map(S.bill);
    const total = bills.reduce((s, b) => s + b.total, 0);
    return { patient: S.patient(p), bills, total };
  });
  res.json(out);
});

// Collect all pending (non-pharmacy) dues for a patient
router.post('/collect', requireRole('reception', 'admin'), (req, res) => {
  const { patientId, mode } = req.body || {};
  if (!patientId || !mode) return res.status(400).json({ error: 'patientId and mode are required.' });

  const txn = db.transaction(() => {
    db.prepare("UPDATE bills SET status = 'Paid', mode = ?, paid_at = ? WHERE patient_id = ? AND status = 'Pending' AND type != 'Pharmacy'")
      .run(mode, now(), patientId);
    db.prepare("UPDATE appointments SET status = 'Completed' WHERE patient_id = ? AND status = 'Awaiting Payment'").run(patientId);
  });
  txn();
  audit(req.user.sub, 'Collect payment', patientId);
  res.json({ ok: true });
});

// Single bill detail (for printing)
router.get('/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Bill not found.' });
  if (req.user.role === 'patient' && req.user.sub !== b.patient_id) return res.status(403).json({ error: 'Not allowed.' });
  const patient = S.patient(db.prepare('SELECT * FROM patients WHERE id = ?').get(b.patient_id));
  res.json({ ...S.bill(b), patient });
});

module.exports = router;
