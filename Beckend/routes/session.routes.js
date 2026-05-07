const express = require('express');
const router  = express.Router();
const { insertSession, updateSession, getSessions, getActiveSession } = require('../services/Session.service');

// ── Cek session aktif berdasarkan tgl + shift (untuk fix multi-device)
router.get('/active', async (req, res) => {
  try {
    const { tgl, shift } = req.query;
    if (!tgl || !shift) {
      return res.status(400).json({ ok: false, error: 'tgl dan shift wajib diisi' });
    }
    const row = await getActiveSession({ tgl, shift: parseInt(shift, 10) });
    if (row) {
      return res.json({ ok: true, session_id: row.id });
    }
    return res.json({ ok: false });
  } catch (err) {
    console.error('[GET /session/active]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Verifikasi session by ID (untuk fix multi-device — device lain cek apakah id-nya masih valid)
router.get('/:id', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId) || sessionId <= 0) {
      return res.status(400).json({ ok: false, error: 'session_id tidak valid' });
    }
    const pool = require('../database/db');
    const [rows] = await pool.execute(
      'SELECT id FROM hasil_produksi WHERE id = ? LIMIT 1',
      [sessionId]
    );
    if (rows.length > 0) {
      return res.json({ ok: true, session_id: rows[0].id });
    }
    return res.status(404).json({ ok: false, error: 'Session tidak ditemukan' });
  } catch (err) {
    console.error('[GET /session/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/start', async (req, res) => {
  try {
    const result = await insertSession(req.body);
    res.status(201).json({ ok: true, session_id: result.id, oee: result });
  } catch (err) {
    console.error('[POST /session/start]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId) || sessionId <= 0) {
      return res.status(400).json({ ok: false, error: 'session_id tidak valid' });
    }
    const result = await updateSession(sessionId, req.body);
    res.json({ ok: true, session_id: sessionId, oee: result });
  } catch (err) {
    console.error('[PUT /session/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await getSessions({
      tgl:   req.query.tgl   || null,
      mesin: req.query.mesin ? parseInt(req.query.mesin, 10) : null,
      shift: req.query.shift ? parseInt(req.query.shift, 10) : null,
    });
    res.json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[GET /session]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;