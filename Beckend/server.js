const express = require('express');
const path    = require('path');
const cors    = require('cors');     // 🔥 tambah ini
require('dotenv').config();          // optional untuk .env

const app = express();

/* ── Middleware ───────────────────────────────────────── */

app.use(cors());                     // 🔥 FIX CORS
app.use(express.json());

/* ── Routes ──────────────────────────────────────────── */

const sensorRoutes  = require('./routes/sensor.routes');
const sessionRoutes = require('./routes/session.routes');

app.use('/api/sensor',  sensorRoutes);
app.use('/api/session', sessionRoutes);

/* ── Static & HTML ───────────────────────────────────── */

app.use(express.static(path.join(__dirname, '../Frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/dashboard/home.html'));
});

/* ── Start Server ────────────────────────────────────── */

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});