const express = require('express');
const path    = require('path');
const cors    = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const sensorRoutes   = require('./routes/sensor.routes');
const sessionRoutes  = require('./routes/session.routes');
const rejectRoutes   = require('./routes/Reject.routes');
const downtimeRoutes = require('./routes/Downtime.routes');

app.use('/api/sensor',   sensorRoutes);
app.use('/api/session',  sessionRoutes);
app.use('/api/reject',   rejectRoutes);
app.use('/api/downtime', downtimeRoutes);

app.use(express.static(path.join(__dirname, '../Frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/dashboard/home.html'));
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});