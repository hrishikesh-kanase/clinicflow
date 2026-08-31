require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db'); // ensures schema is created before routes load
require('./db/seed')(); // idempotent — seeds only if empty

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/branding', require('./routes/branding'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/treatments', require('./routes/treatments'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// Uploaded branding assets (logos) — served from the persistent storage folder
app.use('/uploads', express.static(path.join(__dirname, 'storage', 'uploads')));

// Serve the frontend (single deployable app)
const frontendDir = path.join(__dirname, 'public');
app.use(express.static(frontendDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Central error handler — keeps a bad request from crashing the process
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ClinicFlow backend listening on http://localhost:${PORT}`);
});
