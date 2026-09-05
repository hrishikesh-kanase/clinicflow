-- ClinicFlow schema (SQLite)

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('reception','doctor','pharmacy','treatment','admin')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  mobile      TEXT UNIQUE NOT NULL,
  first_visit TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  id         TEXT PRIMARY KEY,
  mobile     TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id                     TEXT PRIMARY KEY,
  patient_id             TEXT NOT NULL REFERENCES patients(id),
  date                   TEXT NOT NULL,
  slot                   TEXT NOT NULL,
  token                  INTEGER,
  purpose                TEXT NOT NULL,
  status                 TEXT NOT NULL,
  booked_by              TEXT NOT NULL,
  doctor                 TEXT NOT NULL DEFAULT 'doctor',
  need_treat             INTEGER NOT NULL DEFAULT 0,
  reminder_tomorrow_sent INTEGER NOT NULL DEFAULT 0, -- "your appointment is tomorrow" alert already emailed
  reminder_today_sent    INTEGER NOT NULL DEFAULT 0, -- "your appointment is today" alert already emailed
  created_at             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id             TEXT PRIMARY KEY,
  appt_id        TEXT NOT NULL REFERENCES appointments(id),
  patient_id     TEXT NOT NULL REFERENCES patients(id),
  doctor         TEXT NOT NULL,
  complaints     TEXT,
  observations   TEXT,
  diagnosis      TEXT,
  treatment_reco TEXT,
  next_visit     TEXT,
  tests          TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id            TEXT PRIMARY KEY,
  visit_id      TEXT NOT NULL REFERENCES visits(id),
  name          TEXT NOT NULL,
  dosage        TEXT,
  freq          TEXT,
  duration      TEXT,
  food          TEXT,
  qty           INTEGER NOT NULL,
  note          TEXT,
  not_in_stock  INTEGER NOT NULL DEFAULT 0 -- 1 = doctor prescribed a medicine the clinic doesn't stock; informational only, never billed/dispensed here
);

CREATE TABLE IF NOT EXISTS inventory (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  batch    TEXT NOT NULL,
  expiry   TEXT NOT NULL,
  qty      INTEGER NOT NULL DEFAULT 0,
  cost     REAL NOT NULL DEFAULT 0,
  price    REAL NOT NULL DEFAULT 0,
  gst      REAL NOT NULL DEFAULT 0,
  reorder  INTEGER NOT NULL DEFAULT 20,
  supplier TEXT
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  batch  TEXT NOT NULL,
  type   TEXT NOT NULL CHECK(type IN ('IN','OUT')),
  qty    INTEGER NOT NULL,
  ref    TEXT,
  at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS treatments (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  cost   REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS treatment_records (
  id            TEXT PRIMARY KEY,
  appt_id       TEXT NOT NULL REFERENCES appointments(id),
  patient_id    TEXT NOT NULL REFERENCES patients(id),
  treatment_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  fee           REAL NOT NULL,
  next_visit    TEXT,
  operator      TEXT,
  at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  appt_id    TEXT,
  visit_id   TEXT,
  type       TEXT NOT NULL CHECK(type IN ('Consultation','Pharmacy','Treatment')),
  items      TEXT NOT NULL, -- JSON array
  subtotal   REAL NOT NULL,
  gst        REAL NOT NULL,
  total      REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Pending',
  mode       TEXT,
  paid_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id     TEXT PRIMARY KEY,
  user   TEXT,
  action TEXT NOT NULL,
  ref    TEXT,
  at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(name);
