const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const S = require('../db/serialize');
const { uid, now, todayISO, daysUntil } = require('../utils');
const { requireAuth, requireRole } = require('../middleware/auth');
const { runDailyReminders } = require('../services/reminderScheduler');

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
// The dashboard is split into four admin-selectable tabs (Patients,
// Treatment, Fees, Stock), each with its own "Today / MTD / YTD" range —
// this single endpoint returns the numbers for all four at once for the
// requested range, since none of them are expensive to compute for a
// clinic-scale dataset.
//
// "MTD"/"YTD" here mean the *whole* current calendar month/year (1st to
// last day), not strictly "up to today" — so a patient booked for later
// this month still shows up (as "Expected"), which is what makes the
// Expected bucket meaningful for a forward-looking range.
function dashboardDateRange(range) {
  const t = todayISO();
  if (range === 'mtd') {
    const [y, m] = t.split('-');
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
  }
  if (range === 'ytd') {
    const y = t.split('-')[0];
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  return { start: t, end: t }; // 'today' (and the fallback for anything unrecognised)
}

// Buckets a list of appointments into the 5 patient/treatment-tab metrics.
// "Visited" = fully completed. "Waiting" = arrived and somewhere mid-flow
// (with the doctor, in pharmacy/treatment, or awaiting payment) — i.e.
// checked in but not yet done. "Expected" = booked but not yet arrived.
const WAITING_STATUSES = ['With Doctor', 'In Pharmacy', 'In Treatment', 'Awaiting Payment'];
function bucketAppointments(list) {
  return {
    total: list.length,
    visited: list.filter(a => a.status === 'Completed').length,
    checkedIn: list.filter(a => a.status === 'Checked-in').length,
    waiting: list.filter(a => WAITING_STATUSES.includes(a.status)).length,
    expected: list.filter(a => a.status === 'Booked').length,
  };
}

router.get('/dashboard', requireRole('admin'), (req, res) => {
  const range = ['today', 'mtd', 'ytd'].includes(req.query.range) ? req.query.range : 'today';
  const { start, end } = dashboardDateRange(range);
  const t = todayISO();
  const inRange = (d) => d >= start && d <= end;

  const allAppts = db.prepare('SELECT * FROM appointments').all();
  const apptsInRange = allAppts.filter(a => inRange(a.date));

  const purposes = ['Skin Issue', 'Hair Issue', 'Treatment', 'Others'];
  const byPurpose = {};
  purposes.forEach(p => { byPurpose[p] = apptsInRange.filter(a => a.purpose === p).length; });

  const patients = { ...bucketAppointments(apptsInRange), byPurpose };
  const treatment = bucketAppointments(apptsInRange.filter(a => a.need_treat));

  // Fees: "collected" and the doctor/treatment/medical split respect the
  // selected range (by the bill's paid date); "pending" is always the
  // live outstanding balance (a snapshot, not a period total); "today's
  // earning" is always shown as a fixed reference figure alongside
  // whichever range is selected.
  const paidBills = db.prepare("SELECT * FROM bills WHERE status = 'Paid' AND paid_at IS NOT NULL").all();
  const billDate = (b) => new Date(b.paid_at).toISOString().slice(0, 10);
  const paidInRange = paidBills.filter(b => inRange(billDate(b)));
  const sumType = (type) => paidInRange.filter(b => b.type === type).reduce((s, b) => s + b.total, 0);
  const pending = db.prepare("SELECT COALESCE(SUM(total),0) s FROM bills WHERE status = 'Pending'").get().s;
  const todayEarning = paidBills.filter(b => billDate(b) === t).reduce((s, b) => s + b.total, 0);

  const fees = {
    collected: paidInRange.reduce((s, b) => s + b.total, 0),
    pending,
    doctorEarning: sumType('Consultation'),
    treatmentEarning: sumType('Treatment'),
    medicalEarning: sumType('Pharmacy'),
    todayEarning,
  };

  const nameReorder = {};
  db.prepare('SELECT name, MIN(reorder) reorder FROM inventory GROUP BY name').all().forEach(r => { nameReorder[r.name] = r.reorder; });
  const lowStock = Object.keys(nameReorder).filter(n => invQty(n) <= nameReorder[n]);
  const near = nearExpiryDays();
  const nearExp = db.prepare('SELECT * FROM inventory').all().filter(i => daysUntil(i.expiry) <= near).map(S.inventory);
  const stock = {
    lowStock: lowStock.map(n => ({ name: n, qty: invQty(n) })),
    nearExpiry: nearExp,
  };

  res.json({ range, start, end, date: t, patients, treatment, fees, stock });
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

// ---- Reminders --------------------------------------------------------
// Lets an admin trigger the daily 10 AM reminder pass on demand — handy for
// confirming the configured alert email actually works without waiting for
// the next scheduled run.
router.post('/reminders/run-now', requireRole('admin'), async (req, res) => {
  try {
    const result = await runDailyReminders();
    audit(req.user.sub, 'Run reminders now', JSON.stringify(result));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
