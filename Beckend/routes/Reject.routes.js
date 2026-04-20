const express = require('express');
const router  = express.Router();
const { insertRejectSession, getRejectSessions } = require('../services/Reject.service');

router.post('/submit', async (req, res) => {
  try {
    const result = await insertRejectSession(req.body);
    res.status(201).json({ ok: true, reject_id: result.id, total_reject: result.total_reject });
  } catch (err) {
    console.error('[POST /reject/submit]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await getRejectSessions({
      tgl:   req.query.tgl   || null,
      shift: req.query.shift ? parseInt(req.query.shift, 10) : null,
    });
    res.json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[GET /reject]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
module.exports = router;