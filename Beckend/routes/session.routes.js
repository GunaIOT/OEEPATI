const express = require('express');
const router  = express.Router();
const { insertSession, updateSession, getSessions } = require('../services/Session.service');

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