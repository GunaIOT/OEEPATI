const express = require('express');
const app = express();
const sensorRoutes = require('./routes/sensor.routes');

app.use(express.json());
app.use('/api/sensor', sensorRoutes);

app.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
