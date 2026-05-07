const pool = require('../database/db');

const msToSec = (ms) => Math.round((ms || 0) / 1000);

function calcOEE({
  target_m1 = 0, target_m2 = 0,
  setup_time_ms = 0, downtime_ms = 0, minor_breakdown_ms = 0, total_reject = 0
}) {
  const MS_PER_PCS_PARALEL = 1034;
  const loadingMs   = (target_m1 + target_m2) * MS_PER_PCS_PARALEL;
  const operatingMs = Math.max(loadingMs - setup_time_ms - downtime_ms, 0);
  const netOpMs     = Math.max(operatingMs - minor_breakdown_ms, 0);
  const netOpMenit  = netOpMs / 60000;
  const ar  = loadingMs   > 0 ? Math.max(((loadingMs - setup_time_ms - downtime_ms) / loadingMs) * 100, 0) : 0;
  const pr  = operatingMs > 0 ? Math.min((netOpMs / operatingMs) * 100, 100) : 0;
  const qr  = netOpMenit  > 0 ? Math.max(Math.min((1 - (total_reject / 58) / netOpMenit) * 100, 100), 0) : 0;
  const oee = (ar / 100) * (pr / 100) * (qr / 100) * 100;
  return {
    loading_time_s:       msToSec(loadingMs),
    operating_time_s:     msToSec(operatingMs),
    net_operating_time_s: msToSec(netOpMs),
    ar:  parseFloat(ar.toFixed(2)),
    pr:  parseFloat(pr.toFixed(2)),
    qr:  parseFloat(qr.toFixed(2)),
    oee: parseFloat(oee.toFixed(2)),
  };
}

async function insertRejectSession(payload) {
  const { tgl_produksi, shift = 1, product = '-', target = 0,
    kosong = 0, coding = 0, seal = 0, kurang_angin = 0, gramasi = 0, lain_lain = 0 } = payload;
  const total_reject = kosong + coding + seal + kurang_angin + gramasi + lain_lain;
  const [result] = await pool.execute(
    `INSERT INTO reject_mesin4 (tgl_produksi, shift, product, target, waktu_submit,
      kosong, coding, seal, kurang_angin, gramasi, lain_lain, total_reject)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
    [tgl_produksi, shift, product, target, kosong, coding, seal, kurang_angin, gramasi, lain_lain, total_reject]
  );
  return { id: result.insertId, total_reject };
}

async function getRejectSessions({ tgl, shift } = {}) {
  const where = [], params = [];
  if (tgl)   { where.push('tgl_produksi = ?'); params.push(tgl); }
  if (shift) { where.push('shift = ?'); params.push(shift); }
  const [rows] = await pool.execute(
    `SELECT * FROM reject_mesin4 ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`,
    params
  );
  return rows;
}

async function insertSession(payload) {
  const { tgl_produksi, shift = 1, product = '-',
    target_m1 = 0, target_m2 = 0, finish_goods = 0, total_reject = 0,
    setup_time_ms = 0, minor_breakdown_ms = 0, downtime_ms = 0 } = payload;
  const oee = calcOEE({ target_m1, target_m2, setup_time_ms, downtime_ms, minor_breakdown_ms, total_reject });
  const [result] = await pool.execute(
    `INSERT INTO hasil_produksi
     (tgl_produksi, shift, product, target_m1, target_m2, target,
      finish_goods, total_reject, setup_time_ms, minor_breakdown_ms, downtime_ms,
      loading_time_s, operating_time_s, net_operating_time_s, ar, pr, qr, oee, session_start, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [tgl_produksi, shift, product, target_m1, target_m2, target_m1 + target_m2,
     finish_goods, total_reject, setup_time_ms, minor_breakdown_ms, downtime_ms,
     oee.loading_time_s, oee.operating_time_s, oee.net_operating_time_s,
     oee.ar, oee.pr, oee.qr, oee.oee]
  );
  return { id: result.insertId, ...oee };
}

async function updateSession(sessionId, payload) {
  const { target_m1 = 0, target_m2 = 0, finish_goods = 0, total_reject = 0,
    setup_time_ms = 0, minor_breakdown_ms = 0, downtime_ms = 0 } = payload;
  const oee = calcOEE({ target_m1, target_m2, setup_time_ms, downtime_ms, minor_breakdown_ms, total_reject });
  await pool.execute(
    `UPDATE hasil_produksi SET
      target_m1 = ?, target_m2 = ?, target = ?,
      finish_goods = ?, total_reject = ?,
      setup_time_ms = ?, minor_breakdown_ms = ?, downtime_ms = ?,
      loading_time_s = ?, operating_time_s = ?, net_operating_time_s = ?,
      ar = ?, pr = ?, qr = ?, oee = ?, last_updated = NOW()
     WHERE id = ?`,
    [target_m1, target_m2, target_m1 + target_m2, finish_goods, total_reject,
     setup_time_ms, minor_breakdown_ms, downtime_ms,
     oee.loading_time_s, oee.operating_time_s, oee.net_operating_time_s,
     oee.ar, oee.pr, oee.qr, oee.oee, sessionId]
  );
  return oee;
}

async function getSessions({ tgl, shift } = {}) {
  const where = [], params = [];
  if (tgl)   { where.push('tgl_produksi = ?'); params.push(tgl); }
  if (shift) { where.push('shift = ?'); params.push(shift); }
  const [rows] = await pool.execute(
    `SELECT * FROM hasil_produksi ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`,
    params
  );
  return rows;
}

// ── Cek session aktif berdasarkan tgl + shift
async function getActiveSession({ tgl, shift } = {}) {
  if (!tgl || !shift) return null;
  const [rows] = await pool.execute(
    `SELECT id FROM hasil_produksi WHERE tgl_produksi = ? AND shift = ? ORDER BY id DESC LIMIT 1`,
    [tgl, parseInt(shift)]
  );
  return rows.length > 0 ? rows[0] : null;
}

// ── Ambil seluruh kolom session by ID — dipakai dashboard untuk sync state ke semua device
// CATATAN: Jika kolom target_m1/target_m2/setup_time_ms/minor_breakdown_ms/downtime_ms/total_reject
//          belum ada di tabel hasil_produksi, jalankan migration ini dulu:
//
// ALTER TABLE hasil_produksi
//   ADD COLUMN IF NOT EXISTS target_m1         INT     DEFAULT 0,
//   ADD COLUMN IF NOT EXISTS target_m2         INT     DEFAULT 0,
//   ADD COLUMN IF NOT EXISTS total_reject       INT     DEFAULT 0,
//   ADD COLUMN IF NOT EXISTS setup_time_ms      BIGINT  DEFAULT 0,
//   ADD COLUMN IF NOT EXISTS minor_breakdown_ms BIGINT  DEFAULT 0,
//   ADD COLUMN IF NOT EXISTS downtime_ms        BIGINT  DEFAULT 0;
async function getSessionById(sessionId) {
  const [rows] = await pool.execute(
    `SELECT id, tgl_produksi, shift, product,
       target_m1, target_m2, target,
       finish_goods, total_reject,
       setup_time_ms, minor_breakdown_ms, downtime_ms,
       loading_time_s, operating_time_s, net_operating_time_s,
       ar, pr, qr, oee, session_start, last_updated
     FROM hasil_produksi WHERE id = ? LIMIT 1`,
    [sessionId]
  );
  return rows.length > 0 ? rows[0] : null;
}

module.exports = {
  insertRejectSession,
  getRejectSessions,
  insertSession,
  updateSession,
  getSessions,
  calcOEE,
  getActiveSession,
  getSessionById,
};