CREATE DATABASE IF NOT EXISTS oee_production
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE oee_production;
CREATE TABLE IF NOT EXISTS production_sessions (
  id                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  tgl_produksi         DATE          NOT NULL ,
  shift                TINYINT       NOT NULL DEFAULT 1,
  product              VARCHAR(100)  NOT NULL DEFAULT '',
  session_start        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ,
  last_updated         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP ,

  -- Produksi
  target               INT UNSIGNED  NOT NULL DEFAULT 0  ,
  finish_goods         INT UNSIGNED  NOT NULL DEFAULT 0   ,

  -- Waktu OEE (dalam detik)
  loading_time_s       INT UNSIGNED  NOT NULL DEFAULT 0   ,
  operating_time_s     INT UNSIGNED  NOT NULL DEFAULT 0  ,
  net_operating_time_s INT UNSIGNED  NOT NULL DEFAULT 0  ,

  -- OEE Metrics
  ar                   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  pr                   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  qr                   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  oee                  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,

  PRIMARY KEY (id),
  INDEX idx_tgl     (tgl_produksi),
  INDEX idx_shift   (shift),
  INDEX idx_session (tgl_produksi, shift)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ═══════════════════════════════════════════════════════════════
-- VIEW: Ringkasan harian per shift
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_daily_summary AS
SELECT
  tgl_produksi,
  shift,
  product,
  COUNT(*)              AS jumlah_sesi,
  SUM(target)           AS total_target,
  SUM(finish_goods)     AS total_finish_goods,
  ROUND(AVG(ar),  2)    AS avg_ar,
  ROUND(AVG(pr),  2)    AS avg_pr,
  ROUND(AVG(qr),  2)    AS avg_qr,
  ROUND(AVG(oee), 2)    AS avg_oee,
  MIN(session_start)    AS jam_mulai,
  MAX(last_updated)     AS jam_terakhir
FROM production_sessions
GROUP BY tgl_produksi, shift, product
ORDER BY tgl_produksi DESC, shift ASC;


