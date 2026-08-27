// Seeds default staff users, treatments, inventory and a little sample
// clinical history — mirrors the data the original prototype shipped with.
// Safe to run multiple times: skips anything that already exists.
const bcrypt = require('bcryptjs');
const db = require('./index');
const { uid, now, todayISO, addDays } = require('../utils');

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0) {
    console.log('Seeding staff users...');
    const staff = [
      { id: 'reception', name: 'Priya (Front Desk)', username: 'reception', password: 'reception123', role: 'reception' },
      { id: 'doctor', name: 'Dr. Mehta', username: 'doctor', password: 'doctor123', role: 'doctor' },
      { id: 'pharmacy', name: 'Ravi (Pharmacy)', username: 'pharmacy', password: 'pharmacy123', role: 'pharmacy' },
      { id: 'treatment', name: 'Sana (Treatment)', username: 'treatment', password: 'treatment123', role: 'treatment' },
      { id: 'admin', name: 'Admin', username: 'admin', password: 'admin123', role: 'admin' },
    ];
    const ins = db.prepare(`INSERT INTO users (id,name,username,password_hash,role,active,created_at)
      VALUES (@id,@name,@username,@password_hash,@role,1,@created_at)`);
    for (const u of staff) {
      ins.run({ ...u, password_hash: bcrypt.hashSync(u.password, 10), created_at: now() });
    }
  }

  const settingsCount = db.prepare('SELECT COUNT(*) c FROM settings').get().c;
  if (settingsCount === 0) {
    console.log('Seeding settings...');
    const ins = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    ins.run('consultationFee', '500');
    ins.run('nearExpiryDays', '60');
    ins.run('clinicName', 'ClinicFlow');
    ins.run('logoUrl', '');
  }

  const treatCount = db.prepare('SELECT COUNT(*) c FROM treatments').get().c;
  if (treatCount === 0) {
    console.log('Seeding treatments...');
    const ins = db.prepare('INSERT INTO treatments (id,name,cost,active) VALUES (?,?,?,1)');
    ins.run('T1', 'PRP Hair Therapy', 3000);
    ins.run('T2', 'Chemical Peel', 2500);
    ins.run('T3', 'Laser Hair Removal', 4000);
    ins.run('T4', 'Acne Scar Treatment', 1800);
  }

  const invCount = db.prepare('SELECT COUNT(*) c FROM inventory').c;
  const invActualCount = db.prepare('SELECT COUNT(*) c FROM inventory').get().c;
  if (invActualCount === 0) {
    console.log('Seeding inventory...');
    const ins = db.prepare(`INSERT INTO inventory (id,name,batch,expiry,qty,cost,price,gst,reorder,supplier)
      VALUES (@id,@name,@batch,@expiry,@qty,@cost,@price,@gst,@reorder,@supplier)`);
    const items = [
      { name: 'Cetirizine 10mg', batch: 'CT2401', expiry: addDays(todayISO(), 400), qty: 120, cost: 1.2, price: 3, gst: 12, reorder: 40, supplier: 'MediWholesale' },
      { name: 'Paracetamol 500mg', batch: 'PC2312', expiry: addDays(todayISO(), 35), qty: 28, cost: 0.8, price: 2, gst: 12, reorder: 60, supplier: 'MediWholesale' },
      { name: 'Paracetamol 500mg', batch: 'PC2405', expiry: addDays(todayISO(), 500), qty: 200, cost: 0.9, price: 2, gst: 12, reorder: 60, supplier: 'MediWholesale' },
      { name: 'Minoxidil 5% Soln', batch: 'MX2403', expiry: addDays(todayISO(), 300), qty: 15, cost: 180, price: 320, gst: 18, reorder: 10, supplier: 'DermaSupply' },
      { name: 'Adapalene Gel', batch: 'AD2402', expiry: addDays(todayISO(), 50), qty: 9, cost: 95, price: 180, gst: 12, reorder: 12, supplier: 'DermaSupply' },
      { name: 'Azithromycin 500mg', batch: 'AZ2404', expiry: addDays(todayISO(), 600), qty: 60, cost: 6, price: 14, gst: 12, reorder: 20, supplier: 'MediWholesale' },
    ];
    for (const it of items) ins.run({ id: uid('M'), ...it });
  }

  const patCount = db.prepare('SELECT COUNT(*) c FROM patients').get().c;
  if (patCount === 0) {
    console.log('Seeding sample patients + history...');
    const insP = db.prepare('INSERT INTO patients (id,name,mobile,first_visit,created_at) VALUES (?,?,?,?,?)');
    const p1 = { id: uid('P'), name: 'Anil Kumar', mobile: '9820011111' };
    const p2 = { id: uid('P'), name: 'Meera Shah', mobile: '9820022222' };
    const p3 = { id: uid('P'), name: 'Rohan Das', mobile: '9820033333' };
    [p1, p2, p3].forEach(p => insP.run(p.id, p.name, p.mobile, todayISO(), now()));

    const insA = db.prepare(`INSERT INTO appointments (id,patient_id,date,slot,token,purpose,status,booked_by,doctor,need_treat,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,0,?)`);
    const pastApptId = uid('A');
    insA.run(pastApptId, p1.id, addDays(todayISO(), -14), '10:30', 3, 'Skin Issue', 'Completed', 'reception', 'doctor', now() - 14 * 86400000);

    const insV = db.prepare(`INSERT INTO visits (id,appt_id,patient_id,doctor,complaints,observations,diagnosis,treatment_reco,next_visit,tests,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const pastVisitId = uid('V');
    insV.run(pastVisitId, pastApptId, p1.id, 'doctor', 'Itchy rash on forearm, 5 days', 'Erythematous patches, mild scaling', 'Contact dermatitis', '', todayISO(), '', now() - 14 * 86400000);

    const insR = db.prepare(`INSERT INTO prescriptions (id,visit_id,name,dosage,freq,duration,food,qty,note) VALUES (?,?,?,?,?,?,?,?,?)`);
    insR.run(uid('R'), pastVisitId, 'Cetirizine 10mg', '1 tab', '0-0-1', '5 days', 'After food', 5, '');

    insA.run(uid('A'), p2.id, todayISO(), '11:00', 1, 'Hair Issue', 'Checked-in', 'reception', 'doctor', now() - 40 * 60000);
    insA.run(uid('A'), p1.id, todayISO(), '11:30', 2, 'Skin Issue', 'Booked', 'patient', 'doctor', now() - 30 * 60000);
    insA.run(uid('A'), p3.id, addDays(todayISO(), 2), '16:00', null, 'Treatment', 'Booked', 'reception', 'doctor', now());
  }

  console.log('Seed complete.');
}

module.exports = seed;

if (require.main === module) {
  seed();
}
