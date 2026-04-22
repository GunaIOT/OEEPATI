require('dotenv').config();
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'user_oeeM4',
  password:           process.env.DB_PASSWORD || 'oeeM4',
  database:           process.env.DB_NAME     || 'oee_mesin4',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+07:00',
});

db.getConnection()
  .then(conn => {
    console.log('✅ MySQL Connected —', process.env.DB_NAME || 'oee_mesin4');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL Connection Error:', err.message);
  });

module.exports = db;