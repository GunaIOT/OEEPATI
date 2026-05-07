// Beckend/routes/Downtime.routes.js
const express = require('express');
const router  = express.Router();
const {
  insertUpdateDowntime, updateUpdateDowntime, getUpdateDowntime,
  insertPopupDowntime, getPopupDowntime, getActiveDowntimeSession,
} = require('../services/Downtime.service');

// ── Cek downtime session aktif berdasarkan tgl + shift (untuk fix multi-device)
router.get('/active', async (req, res) => {
  try {
    const { tgl, shift } = req.query;
    if (!tgl || !shift) {
      return res.status(400).json({ ok: false, error: 'tgl dan shift wajib diisi' });
    }
    const row = await getActiveDowntimeSession({ tgl, shift: parseInt(shift, 10) });
    if (row) {
      return res.json({ ok: true, session_id: row.id });
    }
    return res.json({ ok: false });
  } catch (err) {
    console.error('[GET /downtime/active]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/update/start', async (req, res) => {
  try {
    const result = await insertUpdateDowntime(req.body);
    res.status(201).json({ ok: true, session_id: result.id });
  } catch (err) {
    console.error('[POST /downtime/update/start]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/update/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ ok: false, error: 'id tidak valid' });
    await updateUpdateDowntime(id, req.body);
    res.json({ ok: true, session_id: id });
  } catch (err) {
    console.error('[PUT /downtime/update/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/update', async (req, res) => {
  try {
    const rows = await getUpdateDowntime({
      tgl:   req.query.tgl   || null,
      shift: req.query.shift ? parseInt(req.query.shift, 10) : null,
    });
    res.json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/popup', async (req, res) => {
  try {
    const result = await insertPopupDowntime(req.body);
    res.status(201).json({ ok: true, popup_id: result.id });
  } catch (err) {
    console.error('[POST /downtime/popup]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/popup', async (req, res) => {
  try {
    const rows = await getPopupDowntime({
      tgl:   req.query.tgl   || null,
      shift: req.query.shift ? parseInt(req.query.shift, 10) : null,
    });
    res.json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;