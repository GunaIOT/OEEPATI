const express = require('express');
const router = express.Router();

let sensorState = { sensor_status: 0 };

router.post('/', (req, res) => {
    sensorState.sensor_status = req.body.sensor_status;
    console.log("📡 Data dari ESP:", sensorState);
    res.json({ success: true });
});

router.get('/', (req, res) => {
    res.json(sensorState);
});

module.exports = router;
