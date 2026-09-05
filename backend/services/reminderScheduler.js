// --- Appointment reminder scheduler ----------------------------------------
// Runs once a day at 10:00 AM India time (independent of whatever timezone
// the host server itself runs in). It sends one internal alert email — to
// the single address the admin configured in Settings ("Reminder alert
// email") — for every appointment happening tomorrow, and another for every
// appointment happening today. This is a staff-facing heads-up, not a
// message to the patient (patients don't have an email on file today).
//
// Each appointment is only ever alerted once per reminder type, tracked via
// the reminder_tomorrow_sent / reminder_today_sent columns on `appointments`
// — so a server restart mid-day, or the job firing more than once, never
// double-sends.
const cron = require('node-cron');
const db = require('../db');
const { sendMail } = require('./mailer');
const { addDays } = require('../utils');

const TIMEZONE = 'Asia/Kolkata';

// "Today" (or +N days), as a YYYY-MM-DD string in India time — computed
// independently of the server host's own timezone/clock setting.
function istDateISO(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const base = `${map.year}-${map.month}-${map.day}`;
  return offsetDays ? addDays(base, offsetDays) : base;
}

function getReminderEmail() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'reminderEmail'").get();
  return row ? String(row.value).trim() : '';
}

function buildMessage(appt, patient, label) {
  const when = label === 'tomorrow' ? 'tomorrow' : 'today';
  const subject = `Upcoming appointment alert — ${patient.name} (${when})`;
  const text = [
    `Upcoming appointment alert — this patient's appointment is ${when}.`,
    '',
    `Customer name: ${patient.name}`,
    `Phone number: ${patient.mobile}`,
    `Reason / issue: ${appt.purpose}`,
    `Date: ${appt.date}`,
    `Time slot: ${appt.slot}`,
  ].join('\n');
  return { subject, text };
}

async function runPass(label, dateISO, column) {
  const to = getReminderEmail();
  if (!to) {
    console.log(`[Reminders] Skipped "${label}" pass — no reminder alert email configured in Settings yet.`);
    return { checked: 0, sent: 0 };
  }

  const rows = db.prepare(`SELECT * FROM appointments WHERE date = ? AND ${column} = 0`).all(dateISO);
  let sent = 0;
  for (const appt of rows) {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(appt.patient_id);
    if (!patient) continue;
    const { subject, text } = buildMessage(appt, patient, label);
    try {
      await sendMail({ to, subject, text });
      db.prepare(`UPDATE appointments SET ${column} = 1 WHERE id = ?`).run(appt.id);
      sent++;
    } catch (e) {
      console.error(`[Reminders] Failed to send "${label}" reminder for appointment ${appt.id}:`, e.message);
    }
  }
  console.log(`[Reminders] "${label}" pass complete — ${rows.length} appointment(s) checked, ${sent} email(s) sent.`);
  return { checked: rows.length, sent };
}

// `column` is always one of the two hardcoded literals below — never
// user input — so the interpolation above is safe.
async function runDailyReminders() {
  const tomorrow = await runPass('tomorrow', istDateISO(1), 'reminder_tomorrow_sent');
  const today = await runPass('today', istDateISO(0), 'reminder_today_sent');
  return { tomorrow, today };
}

function startReminderScheduler() {
  // 10:00 AM every day, India time — matches the "same day morning sharp
  // 10am" requirement, and covers "one day before" as part of the same run.
  cron.schedule('0 10 * * *', () => {
    runDailyReminders().catch((e) => console.error('[Reminders] Daily run failed:', e));
  }, { timezone: TIMEZONE });
  console.log('[Reminders] Scheduler started — daily run at 10:00 AM IST.');
}

module.exports = { startReminderScheduler, runDailyReminders, istDateISO };

