require('dotenv').config();
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host:               process.env.DB_HOST     || '192.168.3.139',
  port:               parseInt(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'iotuse',
  password:           process.env.DB_PASSWORD || 'iot123',
  database:           process.env.DB_NAME     || 'oee_Pati',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+07:00',
});

db.getConnection()
  .then(conn => {
    console.log('✅ MySQL Connected —', process.env.DB_NAME || 'oee_Pati');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL Connection Error:', err.message);
  });

module.exports = db;