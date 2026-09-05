// --- Stubbed email service ---------------------------------------------
// No SMTP provider is wired in yet. In dev mode (no SMTP_HOST set), the
// email that would be sent is logged to the server console instead, so the
// appointment-reminder scheduler is fully testable without a paid email
// account.
//
// To go live: set these environment variables on your host (e.g. Railway):
//   SMTP_HOST   e.g. smtp.gmail.com, smtp.zoho.in, smtp.sendgrid.net
//   SMTP_PORT   e.g. 587 (defaults to 587 if not set)
//   SMTP_SECURE 'true' for port 465, otherwise leave unset/'false'
//   SMTP_USER   the mailbox/account username
//   SMTP_PASS   the mailbox/account password or app password
//   SMTP_FROM   optional — defaults to SMTP_USER if not set
// No code changes are needed once those are set — sendMail() switches from
// logging to actually sending automatically.
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const LIVE = !!SMTP_HOST;

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

async function sendMail({ to, subject, text }) {
  if (!to) return { sent: false, reason: 'No recipient configured.' };
  if (!LIVE) {
    console.log(`[MAIL][DEV] Would send to ${to}\nSubject: ${subject}\n${text}\n`);
    return { sent: true, dev: true };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({ from, to, subject, text });
  return { sent: true };
}

module.exports = { sendMail, LIVE };

