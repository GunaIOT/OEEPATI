const express = require('express');
const router  = express.Router();
const {
  insertSession, updateSession, getSessions,
  getActiveSession, getSessionById,
} = require('../services/Session.service');

// ── GET /api/session/active
router.get('/active', async (req, res) => {
  try {
    const { tgl, shift } = req.query;
    if (!tgl || !shift)
      return res.status(400).json({ ok: false, error: 'tgl dan shift wajib diisi' });
    const row = await getActiveSession({ tgl, shift: parseInt(shift, 10) });
    if (row) return res.json({ ok: true, session_id: row.id });
    return res.json({ ok: false });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/session/:id — ambil detail untuk sync state ke semua device
router.get('/:id', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId) || sessionId <= 0)
      return res.status(400).json({ ok: false, error: 'session_id tidak valid' });
    const row = await getSessionById(sessionId);
    if (row) return res.json({ ok: true, session_id: row.id, data: row });
    return res.status(404).json({ ok: false, error: 'Session tidak ditemukan' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/session/start — dengan guard find-or-insert di server
router.post('/start', async (req, res) => {
  try {
    const { tgl_produksi, shift } = req.body;

    // Guard: cek dulu sebelum INSERT
    if (tgl_produksi && shift) {
      const existing = await getActiveSession({
        tgl: tgl_produksi, shift: parseInt(shift, 10),
      });
      if (existing) {
        console.log(`[DB] Produksi session sudah ada id=${existing.id} — skip INSERT`);
        return res.status(200).json({ ok: true, session_id: existing.id, reused: true });
      }
    }

    const result = await insertSession(req.body);
    res.status(201).json({ ok: true, session_id: result.id, oee: result, reused: false });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /api/session/:id
router.put('/:id', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId) || sessionId <= 0)
      return res.status(400).json({ ok: false, error: 'session_id tidak valid' });
    const result = await updateSession(sessionId, req.body);
    res.json({ ok: true, session_id: sessionId, oee: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/session
router.get('/', async (req, res) => {
  try {
    const rows = await getSessions({
      tgl:   req.query.tgl   || null,
      shift: req.query.shift ? parseInt(req.query.shift, 10) : null,
    });
    res.json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;