const express = require('express');
const router = express.Router();
const stateService = require('../services/state.service');

router.post('/', (req, res) => {
  const { sensor_status } = req.body;
  const updated = stateService.setState(sensor_status);
  res.json(updated);
});

module.exports = router;
