// --- Stubbed OTP service -----------------------------------------------
// No SMS/WhatsApp provider is wired in yet (this was intentionally left as
// a stub — see README "Going live" section). In dev mode the generated
// code is logged to the console AND returned in the API response so the
// booking flow is fully testable without a paid SMS account.
//
// To go live: replace the body of sendOtp() with a call to your provider
// (e.g. Twilio Verify, MSG91, Gupshup WhatsApp API) and stop returning
// `devCode` from the /api/auth/otp/request route in routes/auth.js.

const DEV_MODE = String(process.env.OTP_DEV_MODE || 'true') === 'true';

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtp(mobile, code) {
  if (DEV_MODE) {
    console.log(`[OTP][DEV] Would send OTP ${code} to ${mobile} via SMS/WhatsApp.`);
    return { sent: true, dev: true };
  }
  // Example (Twilio-style) integration point:
  // await twilioClient.messages.create({ to: mobile, from: FROM, body: `Your ClinicFlow OTP is ${code}` });
  throw new Error('No live OTP provider configured. Set OTP_DEV_MODE=true or implement services/otp.js');
}

module.exports = { generateCode, sendOtp, DEV_MODE };
