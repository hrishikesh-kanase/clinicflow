const express = require('express');
const db = require('../db');
const S = require('../db/serialize');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function canAccessPatient(req, patientId) {
  if (req.user.role === 'patient') return req.user.sub === patientId;
  return ['reception', 'doctor', 'pharmacy', 'treatment', 'admin'].includes(req.user.role);
}

// List all patients (staff only)
router.get('/', requireRole('reception', 'doctor', 'admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM patients ORDER BY created_at DESC').all();
  const withCounts = rows.map(p => {
    const visits = db.prepare('SELECT COUNT(*) c FROM visits WHERE patient_id = ?').get(p.id).c;
    return { ...S.patient(p), visitCount: visits };
  });
  res.json(withCounts);
});

// Get a single patient
router.get('/:id', (req, res) => {
  if (!canAccessPatient(req, req.params.id)) return res.status(403).json({ error: 'Not allowed.' });
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Patient not found.' });
  res.json(S.patient(p));
});

// Full clinical + billing history for a patient (used by the History modal)
router.get('/:id/history', (req, res) => {
  if (!canAccessPatient(req, req.params.id)) return res.status(403).json({ error: 'Not allowed.' });
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Patient not found.' });

  const visits = db.prepare('SELECT * FROM visits WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.id)
    .map(v => {
      const rx = db.prepare('SELECT * FROM prescriptions WHERE visit_id = ?').all(v.id).map(S.prescription);
      const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(v.appt_id);
      return { ...S.visit(v), appointment: S.appointment(appt), prescriptions: rx };
    });

  const bills = db.prepare('SELECT * FROM bills WHERE patient_id = ? ORDER BY created_at DESC').all(req.params.id).map(S.bill);
  const paid = bills.filter(b => b.status === 'Paid').reduce((s, b) => s + b.total, 0);
  const due = bills.filter(b => b.status === 'Pending').reduce((s, b) => s + b.total, 0);

  res.json({ patient: S.patient(p), visits, bills, totals: { paid, due } });
});

module.exports = router;
