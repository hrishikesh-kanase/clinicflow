const express = require('express');
const db = require('../db');
const S = require('../db/serialize');
const { uid, now, todayISO } = require('../utils');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function audit(user, action, ref) {
  db.prepare('INSERT INTO audit (id,user,action,ref,at) VALUES (?,?,?,?,?)').run(uid('L'), user, action, ref, now());
}
function getAppt(id) { return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id); }
function getConsultationFee() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'consultationFee'").get();
  return row ? Number(row.value) : 500;
}
function invByName(name) {
  return db.prepare('SELECT * FROM inventory WHERE name = ? ORDER BY expiry ASC').all(name); // FEFO
}
function invQty(name) {
  const row = db.prepare('SELECT COALESCE(SUM(qty),0) q FROM inventory WHERE name = ?').get(name);
  return row.q;
}

// ---- Book an appointment --------------------------------------------------
// Patient (self): body { date, slot, purpose }
// Reception (on behalf): body { date, slot, purpose, patientId } OR { date, slot, purpose, name, mobile } to create-or-reuse a patient
router.post('/', requireRole('patient', 'reception'), (req, res) => {
  const { date, slot, purpose } = req.body || {};
  if (!date || !slot || !purpose) return res.status(400).json({ error: 'date, slot and purpose are required.' });

  let patientId;
  let bookedBy;
  if (req.user.role === 'patient') {
    patientId = req.user.sub;
    bookedBy = 'patient';
  } else {
    bookedBy = 'reception';
    if (req.body.patientId) {
      const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.body.patientId);
      if (!p) return res.status(404).json({ error: 'Patient not found.' });
      patientId = p.id;
    } else if (req.body.name && req.body.mobile) {
      const mob = String(req.body.mobile).trim();
      let p = db.prepare('SELECT * FROM patients WHERE mobile = ?').get(mob);
      if (!p) {
        p = { id: uid('P'), name: String(req.body.name).trim(), mobile: mob, first_visit: todayISO(), created_at: now() };
        db.prepare('INSERT INTO patients (id,name,mobile,first_visit,created_at) VALUES (@id,@name,@mobile,@first_visit,@created_at)').run(p);
      }
      patientId = p.id;
    } else {
      return res.status(400).json({ error: 'Provide patientId, or name + mobile, to book on behalf of a patient.' });
    }
  }

  const a = { id: uid('A'), patient_id: patientId, date, slot, token: null, purpose, status: 'Booked', booked_by: bookedBy, doctor: 'doctor', need_treat: 0, created_at: now() };
  db.prepare(`INSERT INTO appointments (id,patient_id,date,slot,token,purpose,status,booked_by,doctor,need_treat,created_at)
    VALUES (@id,@patient_id,@date,@slot,@token,@purpose,@status,@booked_by,@doctor,@need_treat,@created_at)`).run(a);
  audit(req.user.sub, 'Book appointment', a.id);
  res.status(201).json(S.appointment(a));
});

// ---- List appointments (staff front desk view) ----------------------------
router.get('/', requireRole('reception', 'admin'), (req, res) => {
  const scope = req.query.scope || 'today';
  const t = todayISO();
  let rows;
  if (scope === 'today') rows = db.prepare('SELECT * FROM appointments WHERE date = ? ORDER BY date, slot').all(t);
  else if (scope === 'upcoming') rows = db.prepare('SELECT * FROM appointments WHERE date > ? ORDER BY date, slot').all(t);
  else rows = db.prepare('SELECT * FROM appointments WHERE date < ? ORDER BY created_at DESC').all(t);

  const withPatients = rows.map(a => ({ ...S.appointment(a), patient: S.patient(db.prepare('SELECT * FROM patients WHERE id = ?').get(a.patient_id)) }));
  res.json(withPatients);
});

// ---- A patient's own appointments -----------------------------------------
router.get('/mine', requireRole('patient'), (req, res) => {
  const rows = db.prepare('SELECT * FROM appointments WHERE patient_id = ? ORDER BY created_at DESC').all(req.user.sub);
  res.json(rows.map(S.appointment));
});

// ---- Check in (reception) --------------------------------------------------
router.post('/:id/checkin', requireRole('reception'), (req, res) => {
  const a = getAppt(req.params.id);
  if (!a) return res.status(404).json({ error: 'Appointment not found.' });
  if (a.status !== 'Booked') return res.status(409).json({ error: `Cannot check in an appointment with status "${a.status}".` });
  const maxToken = db.prepare('SELECT MAX(token) t FROM appointments WHERE date = ?').get(a.date).t || 0;
  const token = maxToken + 1;
  db.prepare("UPDATE appointments SET status = 'Checked-in', token = ? WHERE id = ?").run(token, a.id);
  audit(req.user.sub, 'Check-in', a.id);
  res.json(S.appointment(getAppt(a.id)));
});

// ---- Doctor: consultation queue -------------------------------------------
router.get('/queue/doctor', requireRole('doctor'), (req, res) => {
  const rows = db.prepare("SELECT * FROM appointments WHERE status = 'Checked-in' AND date = ? ORDER BY token ASC").all(todayISO());
  res.json(rows.map(a => ({ ...S.appointment(a), patient: S.patient(db.prepare('SELECT * FROM patients WHERE id = ?').get(a.patient_id)) })));
});

// ---- Doctor: save consultation + prescription ------------------------------
// body: { complaints, observations, diagnosis, tests, treatmentReco, nextVisit, rx: [{name,dosage,freq,duration,qty,food}] }
const saveConsultationTxn = db.transaction((a, doctorRole, body) => {
  const v = {
    id: uid('V'), appt_id: a.id, patient_id: a.patient_id, doctor: doctorRole,
    complaints: body.complaints || '', observations: body.observations || '', diagnosis: body.diagnosis || '',
    treatment_reco: body.treatmentReco || '', next_visit: body.nextVisit || null, tests: body.tests || '', created_at: now(),
  };
  db.prepare(`INSERT INTO visits (id,appt_id,patient_id,doctor,complaints,observations,diagnosis,treatment_reco,next_visit,tests,created_at)
    VALUES (@id,@appt_id,@patient_id,@doctor,@complaints,@observations,@diagnosis,@treatment_reco,@next_visit,@tests,@created_at)`).run(v);

  const rx = Array.isArray(body.rx) ? body.rx.filter(r => r.name && r.qty > 0) : [];
  const insRx = db.prepare('INSERT INTO prescriptions (id,visit_id,name,dosage,freq,duration,food,qty,note) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const r of rx) insRx.run(uid('R'), v.id, r.name, r.dosage || '', r.freq || '', r.duration || '', r.food || 'After food', r.qty, r.note || '');

  const hasMeds = rx.length > 0;
  const hasTreat = !!body.treatmentReco;
  const status = hasMeds ? 'In Pharmacy' : (hasTreat ? 'In Treatment' : 'Awaiting Payment');
  db.prepare('UPDATE appointments SET status = ?, need_treat = ? WHERE id = ?').run(status, hasTreat ? 1 : 0, a.id);

  const fee = getConsultationFee();
  const bill = {
    id: uid('B'), patient_id: a.patient_id, appt_id: a.id, visit_id: v.id, type: 'Consultation',
    items: JSON.stringify([{ name: 'Doctor consultation', qty: 1, rate: fee, gst: 0, amount: fee }]),
    subtotal: fee, gst: 0, total: fee, status: 'Pending', mode: null, paid_at: null, created_at: now(),
  };
  db.prepare(`INSERT INTO bills (id,patient_id,appt_id,visit_id,type,items,subtotal,gst,total,status,mode,paid_at,created_at)
    VALUES (@id,@patient_id,@appt_id,@visit_id,@type,@items,@subtotal,@gst,@total,@status,@mode,@paid_at,@created_at)`).run(bill);

  return v;
});

router.post('/:id/consultation', requireRole('doctor'), (req, res) => {
  const a = getAppt(req.params.id);
  if (!a) return res.status(404).json({ error: 'Appointment not found.' });
  if (a.status !== 'Checked-in') return res.status(409).json({ error: `Cannot consult — status is "${a.status}".` });
  const v = saveConsultationTxn(a, req.user.name || req.user.sub, req.body || {});
  audit(req.user.sub, 'Save consultation', v.id);
  res.json({ visit: S.visit(v), appointment: S.appointment(getAppt(a.id)) });
});

// ---- Pharmacy: prescription queue ------------------------------------------
router.get('/queue/pharmacy', requireRole('pharmacy'), (req, res) => {
  const rows = db.prepare("SELECT * FROM appointments WHERE status = 'In Pharmacy' ORDER BY created_at DESC").all();
  const out = rows.map(a => {
    const v = db.prepare('SELECT * FROM visits WHERE appt_id = ?').get(a.id);
    const rx = v ? db.prepare('SELECT * FROM prescriptions WHERE visit_id = ?').all(v.id).map(S.prescription) : [];
    return { ...S.appointment(a), patient: S.patient(db.prepare('SELECT * FROM patients WHERE id = ?').get(a.patient_id)), visit: S.visit(v), prescriptions: rx };
  });
  res.json(out);
});

// ---- Pharmacy: dispense + bill (FEFO stock deduction) ----------------------
// body: { lines: [{name, qty}], mode }
router.post('/:id/dispense', requireRole('pharmacy'), (req, res) => {
  const a = getAppt(req.params.id);
  if (!a) return res.status(404).json({ error: 'Appointment not found.' });
  if (a.status !== 'In Pharmacy') return res.status(409).json({ error: `Cannot dispense — status is "${a.status}".` });
  const lines = Array.isArray(req.body.lines) ? req.body.lines.filter(l => l.name && l.qty > 0) : [];
  if (!lines.length) return res.status(400).json({ error: 'Add at least one medicine.' });
  const mode = req.body.mode || 'Cash';

  for (const l of lines) {
    if (l.qty > invQty(l.name)) return res.status(409).json({ error: `Not enough stock of ${l.name} (have ${invQty(l.name)}).` });
  }

  const dispenseTxn = db.transaction(() => {
    const items = []; let sub = 0, gstTot = 0;
    const updateBatch = db.prepare('UPDATE inventory SET qty = qty - ? WHERE id = ?');
    const insMove = db.prepare('INSERT INTO stock_moves (id,name,batch,type,qty,ref,at) VALUES (?,?,?,?,?,?,?)');
    for (const l of lines) {
      let need = l.qty;
      const batches = invByName(l.name);
      const first = batches[0];
      if (!first) throw new Error(`No stock batches found for ${l.name}`);
      const price = l.price ?? first.price;
      const gst = l.gst ?? first.gst;
      for (const b of batches) {
        if (need <= 0) break;
        const take = Math.min(need, b.qty);
        if (take <= 0) continue;
        updateBatch.run(take, b.id);
        insMove.run(uid('S'), l.name, b.batch, 'OUT', take, a.id, now());
        need -= take;
      }
      const amt = l.qty * price, g = amt * gst / 100;
      sub += amt; gstTot += g;
      items.push({ name: l.name, qty: l.qty, rate: price, gst, amount: amt });
    }
    const bill = {
      id: uid('B'), patient_id: a.patient_id, appt_id: a.id, visit_id: null, type: 'Pharmacy',
      items: JSON.stringify(items), subtotal: sub, gst: gstTot, total: sub + gstTot, status: 'Paid', mode, paid_at: now(), created_at: now(),
    };
    db.prepare(`INSERT INTO bills (id,patient_id,appt_id,visit_id,type,items,subtotal,gst,total,status,mode,paid_at,created_at)
      VALUES (@id,@patient_id,@appt_id,@visit_id,@type,@items,@subtotal,@gst,@total,@status,@mode,@paid_at,@created_at)`).run(bill);
    const nextStatus = a.need_treat ? 'In Treatment' : 'Awaiting Payment';
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(nextStatus, a.id);
    return bill;
  });

  try {
    const bill = dispenseTxn();
    audit(req.user.sub, 'Dispense + bill', bill.id);
    res.json(S.bill(bill));
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// ---- Treatment: queue -------------------------------------------------------
router.get('/queue/treatment', requireRole('treatment'), (req, res) => {
  const rows = db.prepare("SELECT * FROM appointments WHERE status = 'In Treatment' ORDER BY created_at DESC").all();
  const out = rows.map(a => {
    const v = db.prepare('SELECT * FROM visits WHERE appt_id = ?').get(a.id);
    return { ...S.appointment(a), patient: S.patient(db.prepare('SELECT * FROM patients WHERE id = ?').get(a.patient_id)), visit: S.visit(v) };
  });
  res.json(out);
});

// ---- Treatment: record treatment performed + bill, optional next visit -----
// body: { treatmentId, fee, nextVisit }
router.post('/:id/treatment', requireRole('treatment'), (req, res) => {
  const a = getAppt(req.params.id);
  if (!a) return res.status(404).json({ error: 'Appointment not found.' });
  if (a.status !== 'In Treatment') return res.status(409).json({ error: `Cannot record treatment — status is "${a.status}".` });
  const t = db.prepare('SELECT * FROM treatments WHERE id = ?').get(req.body.treatmentId);
  if (!t) return res.status(404).json({ error: 'Treatment not found.' });
  const fee = Number(req.body.fee) || t.cost;
  const nextVisit = req.body.nextVisit || null;

  const txn = db.transaction(() => {
    const tr = { id: uid('TR'), appt_id: a.id, patient_id: a.patient_id, treatment_id: t.id, name: t.name, fee, next_visit: nextVisit, operator: req.user.sub, at: now() };
    db.prepare(`INSERT INTO treatment_records (id,appt_id,patient_id,treatment_id,name,fee,next_visit,operator,at)
      VALUES (@id,@appt_id,@patient_id,@treatment_id,@name,@fee,@next_visit,@operator,@at)`).run(tr);
    const bill = {
      id: uid('B'), patient_id: a.patient_id, appt_id: a.id, visit_id: null, type: 'Treatment',
      items: JSON.stringify([{ name: t.name, qty: 1, rate: fee, gst: 0, amount: fee }]),
      subtotal: fee, gst: 0, total: fee, status: 'Pending', mode: null, paid_at: null, created_at: now(),
    };
    db.prepare(`INSERT INTO bills (id,patient_id,appt_id,visit_id,type,items,subtotal,gst,total,status,mode,paid_at,created_at)
      VALUES (@id,@patient_id,@appt_id,@visit_id,@type,@items,@subtotal,@gst,@total,@status,@mode,@paid_at,@created_at)`).run(bill);
    db.prepare("UPDATE appointments SET status = 'Awaiting Payment' WHERE id = ?").run(a.id);

    let nextAppt = null;
    if (nextVisit) {
      nextAppt = { id: uid('A'), patient_id: a.patient_id, date: nextVisit, slot: '10:00', token: null, purpose: 'Treatment', status: 'Booked', booked_by: 'treatment', doctor: 'doctor', need_treat: 0, created_at: now() };
      db.prepare(`INSERT INTO appointments (id,patient_id,date,slot,token,purpose,status,booked_by,doctor,need_treat,created_at)
        VALUES (@id,@patient_id,@date,@slot,@token,@purpose,@status,@booked_by,@doctor,@need_treat,@created_at)`).run(nextAppt);
    }
    return { tr, nextAppt };
  });

  const { tr } = txn();
  audit(req.user.sub, 'Record treatment', a.id);
  res.json(S.treatmentRecord(tr));
});

module.exports = router;
