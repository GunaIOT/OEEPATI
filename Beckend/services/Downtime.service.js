const pool = require('../database/db');
async function insertUpdateDowntime(payload) {
  const {
    tgl_produksi,
    shift             = 1,
    product           = '-',
    total_minor_ms    = 0,
    total_setup_ms    = 0,
    total_downtime_ms = 0,
  } = payload;

  const [result] = await pool.execute(
    `INSERT INTO updateDowntime_m4
       (tgl_produksi, shift, product,
        total_minor_ms, total_setup_ms, total_downtime_ms,
        session_start, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [tgl_produksi, shift, product,
     total_minor_ms, total_setup_ms, total_downtime_ms]
  );

  console.log(`[DB] INSERT updateDowntime_m4 id=${result.insertId}`);
  return { id: result.insertId };
}

async function updateUpdateDowntime(sessionId, payload) {
  const {
    total_minor_ms    = 0,
    total_setup_ms    = 0,
    total_downtime_ms = 0,
  } = payload;

  await pool.execute(
    `UPDATE updateDowntime_m4 SET
       total_minor_ms    = ?,
       total_setup_ms    = ?,
       total_downtime_ms = ?,
       last_updated      = NOW()
     WHERE id = ?`,
    [total_minor_ms, total_setup_ms, total_downtime_ms, sessionId]
  );

  console.log(`[DB] UPDATE updateDowntime_m4 id=${sessionId}`);
}

async function getUpdateDowntime({ tgl, shift } = {}) {
  const where = [], params = [];
  if (tgl)   { where.push('tgl_produksi = ?'); params.push(tgl); }
  if (shift) { where.push('shift = ?');         params.push(shift); }
  const sql = `SELECT * FROM updateDowntime_m4
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT 200`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function insertPopupDowntime(payload) {
  const {
    tgl_produksi,
    shift                 = 1,
    product               = '-',
    minor_durasi_m1_ms    = 0,
    minor_alasan_m1       = '-',
    minor_durasi_m2_ms    = 0,
    minor_alasan_m2       = '-',
    downtime_durasi_m1_ms = 0,
    downtime_alasan_m1    = '-',
    downtime_durasi_m2_ms = 0,
    downtime_alasan_m2    = '-',
    is_shared             = 0,
  } = payload;

  const [result] = await pool.execute(
    `INSERT INTO popupDowntime_m4
       (tgl_produksi, shift, product,
        minor_durasi_m1_ms, minor_alasan_m1,
        minor_durasi_m2_ms, minor_alasan_m2,
        downtime_durasi_m1_ms, downtime_alasan_m1,
        downtime_durasi_m2_ms, downtime_alasan_m2,
        is_shared, waktu_submit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [tgl_produksi, shift, product,
     minor_durasi_m1_ms, minor_alasan_m1,
     minor_durasi_m2_ms, minor_alasan_m2,
     downtime_durasi_m1_ms, downtime_alasan_m1,
     downtime_durasi_m2_ms, downtime_alasan_m2,
     is_shared]
  );

  console.log(`[DB] INSERT popupDowntime_m4 id=${result.insertId} shared=${is_shared}`);
  return { id: result.insertId };
}

async function getPopupDowntime({ tgl, shift } = {}) {
  const where = [], params = [];
  if (tgl)   { where.push('tgl_produksi = ?'); params.push(tgl); }
  if (shift) { where.push('shift = ?');         params.push(shift); }
  const sql = `SELECT * FROM popupDowntime_m4
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT 500`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = {
  insertUpdateDowntime,
  updateUpdateDowntime,
  getUpdateDowntime,
  insertPopupDowntime,
  getPopupDowntime,
};