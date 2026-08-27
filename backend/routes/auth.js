const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { uid, now, todayISO } = require('../utils');
const { signToken, requireAuth } = require('../middleware/auth');
const otpService = require('../services/otp');

const router = express.Router();

const STAFF_TTL = process.env.STAFF_TOKEN_TTL || '12h';
const PATIENT_TTL = process.env.PATIENT_TOKEN_TTL || '24h';

function audit(user, action, ref) {
  db.prepare('INSERT INTO audit (id,user,action,ref,at) VALUES (?,?,?,?,?)').run(uid('L'), user, action, ref, now());
}

// ---- Staff login (reception / doctor / pharmacy / treatment / admin) ----
router.post('/staff/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username).trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const token = signToken({ sub: u.id, role: u.role, name: u.name, kind: 'staff' }, STAFF_TTL);
  audit(u.id, 'Login', u.id);
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
});

// ---- Patient: register as new patient (no OTP — first-time visitor) ----
router.post('/patient/new', (req, res) => {
  const { name, mobile } = req.body || {};
  if (!name || !mobile || String(mobile).trim().length < 10) {
    return res.status(400).json({ error: 'A valid name and 10-digit mobile number are required.' });
  }
  const mob = String(mobile).trim();
  const existing = db.prepare('SELECT * FROM patients WHERE mobile = ?').get(mob);
  if (existing) {
    return res.status(409).json({ error: 'This mobile number is already registered. Please use "Returning patient" and verify with OTP instead.' });
  }
  const p = { id: uid('P'), name: String(name).trim(), mobile: mob, first_visit: todayISO(), created_at: now() };
  db.prepare('INSERT INTO patients (id,name,mobile,first_visit,created_at) VALUES (@id,@name,@mobile,@first_visit,@created_at)').run(p);
  audit(p.id, 'Register patient', p.id);
  const token = signToken({ sub: p.id, role: 'patient', name: p.name, kind: 'patient' }, PATIENT_TTL);
  res.json({ token, patient: { id: p.id, name: p.name, mobile: p.mobile } });
});

// ---- Patient: request OTP for returning-patient login ----
router.post('/patient/otp/request', async (req, res) => {
  const { mobile } = req.body || {};
  if (!mobile) return res.status(400).json({ error: 'Mobile number is required.' });
  const mob = String(mobile).trim();
  const p = db.prepare('SELECT * FROM patients WHERE mobile = ?').get(mob);
  if (!p) return res.status(404).json({ error: 'No record found for this number. Please book as a new patient.' });

  const code = otpService.generateCode();
  db.prepare('INSERT INTO otps (id,mobile,code,expires_at,consumed,created_at) VALUES (?,?,?,?,0,?)')
    .run(uid('O'), mob, code, now() + 5 * 60000, now());

  try {
    const result = await otpService.sendOtp(mob, code);
    res.json({ sent: true, devCode: result.dev ? code : undefined, expiresInSec: 300 });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Patient: verify OTP and log in ----
router.post('/patient/otp/verify', (req, res) => {
  const { mobile, code } = req.body || {};
  if (!mobile || !code) return res.status(400).json({ error: 'Mobile and OTP code are required.' });
  const mob = String(mobile).trim();
  const row = db.prepare(`SELECT * FROM otps WHERE mobile = ? AND consumed = 0 AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1`).get(mob, now());
  if (!row || row.code !== String(code).trim()) {
    return res.status(401).json({ error: 'Incorrect or expired OTP.' });
  }
  db.prepare('UPDATE otps SET consumed = 1 WHERE id = ?').run(row.id);
  const p = db.prepare('SELECT * FROM patients WHERE mobile = ?').get(mob);
  if (!p) return res.status(404).json({ error: 'No record found for this number.' });
  const token = signToken({ sub: p.id, role: 'patient', name: p.name, kind: 'patient' }, PATIENT_TTL);
  audit(p.id, 'Login (OTP)', p.id);
  res.json({ token, patient: { id: p.id, name: p.name, mobile: p.mobile } });
});

// ---- Who am I (used to restore a session from a stored token) ----
router.get('/me', requireAuth, (req, res) => {
  if (req.user.kind === 'patient') {
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.user.sub);
    if (!p) return res.status(404).json({ error: 'Patient no longer exists.' });
    return res.json({ kind: 'patient', patient: { id: p.id, name: p.name, mobile: p.mobile } });
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.user.sub);
  if (!u) return res.status(404).json({ error: 'User no longer active.' });
  res.json({ kind: 'staff', user: { id: u.id, name: u.name, role: u.role } });
});

module.exports = router;
