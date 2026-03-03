let sensorState = {
  sensor_status: "OFF",
  updated_at: null
};

module.exports = {
  getState: () => sensorState,

  setState: (status) => {
    sensorState.sensor_status = status;
    sensorState.updated_at = new Date().toISOString();
    return sensorState;
  }
};