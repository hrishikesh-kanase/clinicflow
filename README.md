# ClinicFlow — Clinic Appointment & Management System

A full-stack rebuild of the original `clinicapp.html` prototype. The look,
layout and workflows are the same; the difference is everything now runs
against a real backend instead of an in-memory object that reset on every
refresh:

- **Real database** — SQLite file (via `better-sqlite3`). Nothing is lost
  on refresh, restart, or between different people using the app at the
  same time.
- **Real login** — no more "pick any role from a dropdown." Staff sign in
  with a username + password. Patients sign in by registering (new
  patient) or verifying an OTP sent to their mobile (returning patient).
  Every action is checked against the logged-in user's role on the server,
  not just hidden in the UI.
- **Same workflows** — front desk → check-in → doctor consultation →
  pharmacy (FEFO stock deduction + billing) → treatment centre → payment
  collection → admin dashboard, exactly as in the original design.
- **White-label branding** — an admin can upload the clinic's own logo and
  rename the app from "ClinicFlow" to the clinic's own name, right from
  the Settings page. No code or file access needed. See "White-labeling
  for multiple clinics" below.

## Project structure

```
clinicflow/
  backend/            Express + SQLite API server
    server.js         Entry point — also serves the frontend
    db/
      schema.sql       Table definitions
      index.js         Opens the SQLite file, applies the schema
      seed.js          Seeds default staff logins + sample data (idempotent)
      reset.js         Wipes and re-seeds the database (npm run seed:reset)
      serialize.js      DB row -> API JSON shape helpers
    middleware/auth.js  JWT verification + role guards
    routes/             One file per resource (auth, patients, appointments,
                         billing, inventory, treatments, admin, branding)
    services/otp.js     Stubbed OTP sender — see "Going live" below
    storage/            Everything that must survive a restart: the SQLite
                         file (storage/data/) and uploaded logos
                         (storage/uploads/). On a host like Railway, point
                         one persistent volume at this single folder.
    .env.example        Copy to .env to configure
  frontend/
    index.html          The entire UI (vanilla JS, no build step)
  README.md             This file
```

## Running it

Requires Node.js 18+ (tested on Node 22).

```bash
cd backend
npm install
cp .env.example .env      # already done for you if you received this zip pre-configured
npm start
```

Then open **http://localhost:4000** — the backend also serves the
frontend, so there's nothing else to run. The database file is created
automatically on first run at `backend/storage/data/clinicflow.db`, seeded with
demo accounts and a little sample data.

To wipe the database and start fresh:

```bash
cd backend
npm run seed:reset
```

## Default logins

Change these before giving anyone else access to the app (see "Users &
Roles" in the admin panel, or update directly in `backend/db/seed.js`
before the first run).

| Role             | Username    | Password       |
|------------------|-------------|----------------|
| Reception        | `reception` | `reception123` |
| Doctor           | `doctor`    | `doctor123`    |
| Pharmacy         | `pharmacy`  | `pharmacy123`  |
| Treatment Centre | `treatment` | `treatment123` |
| Admin            | `admin`     | `admin123`     |

Patients don't need a seeded account — they register themselves from the
login screen ("New patient") or log in with OTP ("Returning patient").

Admins can create additional staff logins from **Users & Roles** once
signed in.

## White-labeling for multiple clinics

**Branding** (available now): log in as admin → **Settings** → the
"Branding" card lets you upload a logo (PNG/JPG/WEBP/SVG, max 2MB) and
rename the app from "ClinicFlow" to the clinic's own name. It shows up
immediately in the topbar, the login screen (patients see it before they
even log in), the browser tab title, and on printed pharmacy bills. No
code changes, no restart needed — any admin can do this themselves.

**Serving more than one clinic** is a deployment decision, not something
this branding feature does on its own:

- *One deployment per clinic* (works today, no further changes needed) —
  each clinic gets its own copy of this app: their own server (or
  subdomain), their own database, their own logo/name set via Settings as
  above. Their data is naturally fully isolated from every other clinic.
  This is the simplest path if you're hand-deploying to a handful of
  clients.
- *One shared deployment serving many clinics* (true multi-tenant SaaS,
  not built) — would need a `clinic_id` on every database table with
  every query scoped to it, a sign-up flow so new clinics can onboard
  themselves, and probably PostgreSQL in place of SQLite for concurrent
  multi-tenant write load. Ask if you want this built out — it's a
  bigger change than the branding feature and worth scoping properly
  first.

## What's stubbed (and how to go live)

Two things were intentionally left as stubs rather than wired to paid
third-party accounts you'd need to supply keys for:

**OTP delivery** (`backend/services/otp.js`) — in dev mode, the OTP code
is logged to the server console and returned directly in the API
response, which is why the login screen shows it on-screen. To go live:
plug a provider (Twilio Verify, MSG91, Gupshup WhatsApp API, etc.) into
`sendOtp()` and set `OTP_DEV_MODE=false` in `.env` so the code stops being
returned to the browser.

**Payment collection** — "Collect · Cash" and "Collect · UPI" mark a bill
as paid immediately (this mirrors the original prototype, which assumed
payment happens at the counter). If you want online payment collection
(e.g. a UPI/Razorpay link sent to the patient), that's a new integration
point in `backend/routes/billing.js`.

Everything else — appointments, consultations, prescriptions, FEFO
pharmacy stock deduction, treatments, billing, inventory, the admin
dashboard — is fully wired to the database, no stubs.

## Security notes before going live

- Change `JWT_SECRET` in `.env` to a long random string.
- There's no "change password" screen for the seeded demo accounts. Before
  real use: log in as `admin`, create a real account per staff member
  under **Users & Roles** with its own strong password, log in as one to
  confirm it works, then disable the five demo accounts (including
  `admin` itself, last) from that same screen.
- Put this behind HTTPS (a reverse proxy like Caddy or nginx, or your
  hosting provider's TLS) — JWTs and OTPs should never travel over plain
  HTTP outside local development.
- SQLite is great for a single clinic on a single server. If you outgrow
  it (very high concurrent write load, multi-server deployment), swap
  `better-sqlite3` for a `pg` (PostgreSQL) client — the SQL in `db/`
  is plain enough to port; the route files don't need to change.
- Back up `backend/storage/data/clinicflow.db` regularly (it's a single file —
  copying it is a complete backup).

## API overview

All endpoints are under `/api`. Staff and patient sessions both use a
JWT bearer token (`Authorization: Bearer <token>`), obtained from
`/api/auth/staff/login`, `/api/auth/patient/new`, or
`/api/auth/patient/otp/verify`.

| Area          | Endpoints |
|---------------|-----------|
| Auth          | `POST /auth/staff/login`, `POST /auth/patient/new`, `POST /auth/patient/otp/request`, `POST /auth/patient/otp/verify`, `GET /auth/me` |
| Patients      | `GET /patients`, `GET /patients/:id`, `GET /patients/:id/history` |
| Appointments  | `POST /appointments`, `GET /appointments?scope=`, `GET /appointments/mine`, `POST /appointments/:id/checkin`, `GET /appointments/queue/doctor`, `POST /appointments/:id/consultation`, `GET /appointments/queue/pharmacy`, `POST /appointments/:id/dispense`, `GET /appointments/queue/treatment`, `POST /appointments/:id/treatment` |
| Billing       | `GET /billing/due`, `POST /billing/collect`, `GET /billing/:id` |
| Inventory     | `GET /inventory`, `POST /inventory`, `POST /inventory/:id/restock` |
| Treatments    | `GET /treatments`, `POST /treatments`, `PUT /treatments/:id`, `PATCH /treatments/:id/toggle` |
| Admin         | `GET /admin/dashboard`, `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/:id/toggle`, `GET /admin/settings`, `PUT /admin/settings` |
| Branding      | `GET /branding` (public, no auth), `POST /branding/logo` (admin, multipart upload), `DELETE /branding/logo` (admin) |

## What was tested

Every flow above was exercised end-to-end (via a headless-browser run
through the actual UI, not just the API) before delivery: staff login for
all five roles, booking on behalf of a patient, check-in, doctor
consultation with a prescription, pharmacy dispensing with live FEFO
stock deduction and GST billing, payment collection, the admin dashboard,
settings, and both patient login paths (new-patient registration and
returning-patient OTP). The database resets to clean seed data before
this zip was packaged.
