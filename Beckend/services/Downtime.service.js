const pool = require('../database/db');

// ══════════════════════════════════════════════════════════════
//  Mutex sederhana — cegah race condition saat 2 request
//  POST /downtime/update/start datang hampir bersamaan
// ══════════════════════════════════════════════════════════════
const _insertLock = new Map(); // key: "tgl|shift"

async function insertUpdateDowntime(payload) {
  const {
    tgl_produksi,
    shift             = 1,
    product           = '-',
    total_minor_ms    = 0,
    total_setup_ms    = 0,
    total_downtime_ms = 0,
  } = payload;

  const lockKey = `${tgl_produksi}|${shift}`;

  // Kalau sedang ada proses INSERT untuk tgl+shift yang sama, tunggu
  if (_insertLock.get(lockKey)) {
    console.log(`[DB] INSERT lock aktif untuk ${lockKey} — tunggu...`);
    await new Promise(r => setTimeout(r, 300));
  }

  // Cek lagi sesudah tunggu — mungkin sudah di-insert oleh request sebelumnya
  const existing = await getActiveDowntimeSession({ tgl: tgl_produksi, shift });
  if (existing) {
    console.log(`[DB] Race condition dicegah — pakai id=${existing.id}`);
    return { id: existing.id };
  }

  _insertLock.set(lockKey, true);
  try {
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
  } finally {
    _insertLock.delete(lockKey);
  }
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

// ── Cek session aktif berdasarkan tgl + shift
// Ini adalah sumber kebenaran tunggal — selalu tanya DB, bukan localStorage
async function getActiveDowntimeSession({ tgl, shift } = {}) {
  if (!tgl || !shift) return null;
  const [rows] = await pool.execute(
    `SELECT id FROM updateDowntime_m4
     WHERE tgl_produksi = ? AND shift = ?
     ORDER BY id DESC LIMIT 1`,
    [tgl, parseInt(shift)]
  );
  return rows.length > 0 ? rows[0] : null;
}

module.exports = {
  getActiveDowntimeSession,
  insertUpdateDowntime,
  updateUpdateDowntime,
  getUpdateDowntime,
  insertPopupDowntime,
  getPopupDowntime,
};