// Converts snake_case SQLite rows into the camelCase shapes the frontend
// expects (these mirror the field names used by the original prototype's
// in-memory objects, so the UI code stays close to the original).

function patient(p) {
  if (!p) return null;
  return { id: p.id, name: p.name, mobile: p.mobile, firstVisit: p.first_visit, createdAt: p.created_at };
}

function appointment(a) {
  if (!a) return null;
  return {
    id: a.id, patientId: a.patient_id, date: a.date, slot: a.slot, token: a.token,
    purpose: a.purpose, status: a.status, bookedBy: a.booked_by, doctor: a.doctor,
    needTreat: !!a.need_treat, createdAt: a.created_at,
  };
}

function visit(v) {
  if (!v) return null;
  return {
    id: v.id, apptId: v.appt_id, patientId: v.patient_id, doctor: v.doctor,
    complaints: v.complaints, observations: v.observations, diagnosis: v.diagnosis,
    treatmentReco: v.treatment_reco, nextVisit: v.next_visit, tests: v.tests, createdAt: v.created_at,
  };
}

function prescription(r) {
  if (!r) return null;
  return { id: r.id, visitId: r.visit_id, name: r.name, dosage: r.dosage, freq: r.freq, duration: r.duration, food: r.food, qty: r.qty, note: r.note };
}

function inventory(i) {
  if (!i) return null;
  return { id: i.id, name: i.name, batch: i.batch, expiry: i.expiry, qty: i.qty, cost: i.cost, price: i.price, gst: i.gst, reorder: i.reorder, supplier: i.supplier };
}

function treatment(t) {
  if (!t) return null;
  return { id: t.id, name: t.name, cost: t.cost, active: !!t.active };
}

function treatmentRecord(t) {
  if (!t) return null;
  return { id: t.id, apptId: t.appt_id, patientId: t.patient_id, treatmentId: t.treatment_id, name: t.name, fee: t.fee, nextVisit: t.next_visit, operator: t.operator, at: t.at };
}

function bill(b) {
  if (!b) return null;
  return {
    id: b.id, patientId: b.patient_id, apptId: b.appt_id, visitId: b.visit_id, type: b.type,
    items: JSON.parse(b.items), subtotal: b.subtotal, gst: b.gst, total: b.total,
    status: b.status, mode: b.mode, paidAt: b.paid_at, createdAt: b.created_at,
  };
}

function user(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username, role: u.role, active: !!u.active };
}

module.exports = { patient, appointment, visit, prescription, inventory, treatment, treatmentRecord, bill, user };
