const pool = require('../database/db');

async function insertRejectSession(payload) {
  const {
    tgl_produksi,
    shift        = 1,
    product      = '-',
    target       = 0,
    kosong       = 0,
    coding       = 0,
    seal         = 0,
    kurang_angin = 0,
    gramasi      = 0,
    lain_lain    = 0,
  } = payload;

  const total_reject = kosong + coding + seal + kurang_angin + gramasi + lain_lain;

  const [result] = await pool.execute(
    `INSERT INTO reject_mesin4
       (tgl_produksi, shift, product, target, waktu_submit,
        kosong, coding, seal, kurang_angin, gramasi, lain_lain, total_reject)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
    [tgl_produksi, shift, product, target,
     kosong, coding, seal, kurang_angin, gramasi, lain_lain, total_reject]
  );

  console.log(`[DB Reject] INSERT id=${result.insertId} — total=${total_reject}`);
  return { id: result.insertId, total_reject };
}

async function getRejectSessions({ tgl, shift } = {}) {
  const where = [], params = [];
  if (tgl)   { where.push('tgl_produksi = ?'); params.push(tgl); }
  if (shift) { where.push('shift = ?');         params.push(shift); }

  const sql = `SELECT * FROM reject_mesin4
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT 500`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { insertRejectSession, getRejectSessions };