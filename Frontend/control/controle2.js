// controle.js — Control Panel Mesin Packing #2
// ─────────────────────────────────────────────
// LOGIKA DOWNTIME:
//
//  Fase 1 — 0:00 s/d 2:59
//    • Lost Time display jalan realtime (live countdown)
//    • Belum ada yang disimpan ke akumulasi
//    • Tidak ada popup
//
//  Fase 2 — 3:00 (popup muncul)
//    • Lost Time display LANGSUNG RESET ke 0 (fase 1 dibatalkan)
//    • Popup muncul, timer popup mulai dari 00:00
//    • Timer popup menghitung total durasi dari awal (bukan dari 3 menit)
//    • Ini adalah Downtime Minor
//
//  Saat user Submit / Tutup popup:
//    • Total durasi dari zeroStart sampai sekarang → masuk downtimeAcc
//    • lostTimeAcc TIDAK bertambah (fase 1 sudah dibatalkan)
//
//  Jika mesin hidup kembali SEBELUM 3 menit:
//    • elapsed → masuk lostTimeAcc (itu memang lost time singkat)
//    • Lost Time display memperlihatkan nilai yang benar
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ── DOM refs ─────────────────────────────────────────────
  const inputOneEl    = document.getElementById('inputOne');
  const inputZeroEl   = document.getElementById('inputZero');
  const totalTargetEl = document.getElementById('totalTarget');
  const setupTimeEl   = document.getElementById('setupTime');
  const lostTimeEl    = document.getElementById('lostTime');
  const runtimeEl     = document.getElementById('runtime');
  const downtimeEl    = document.getElementById('downtime');
  const sensorStatus  = document.getElementById('sensorStatus');
  const targetInput   = document.getElementById('targetInput');
  const numpadModal   = document.getElementById('numpadModal');
  const numpadDisplay = document.getElementById('numpadDisplay');

  // ── Konstanta ─────────────────────────────────────────────
  const MS_PER_PCS  = 2222;
  const LOST_LIMIT  = 3 * 60 * 1000;  // 3 menit = batas masuk downtime

  const MINOR_REASONS     = ['Cleaning', 'Adjustment', 'Material Habis', 'Ganti Rol', 'Minor Inspection', 'Lain-lain'];
  const BREAKDOWN_REASONS = ['Seal Rusak', 'Motor Mati', 'Sensor Error', 'Mesin Macet / Jam', 'Masalah Listrik', 'Kerusakan Mekanik', 'Lain-lain'];

  // ── State produksi ────────────────────────────────────────
  let inputOne    = 0;
  let inputZero   = 0;
  let totalTarget = 0;
  let setupTime   = 0;
  let runtime     = 0;

  // ── Akumulasi waktu ───────────────────────────────────────
  let lostTimeAcc  = 0;   // total lost time final (< 3 menit, sudah selesai)
  let downtimeAcc  = 0;   // total downtime final (>= 3 menit, sudah di-submit)

  // ── Stopwatch lost time (pause/resume) ────────────────────
  // Konsep: stopwatch yang bisa di-pause (saat ada objek) dan resume (saat tidak ada)
  // lostWatch = waktu yang sudah terakumulasi di stopwatch ini (belum tentu final)
  let lostWatch    = 0;   // ms yang sudah terhitung di stopwatch ini (bisa di-pause/resume)
  let watchStart   = null; // timestamp saat stopwatch di-resume (null = sedang pause)
  let inDowntime   = false; // sudah masuk zona downtime (>= 3 menit)?

  // ── State tracker ─────────────────────────────────────────
  let liveTimer        = null;  // setInterval realtime display
  let popupOpen        = false;
  let popupSubmitted   = false;
  let committedDowntime = 0;   // durasi downtime yang sudah di-commit (untuk MQTT publish & log)

  // ── Log event downtime ────────────────────────────────────
  let dtLog = [];

  // ── Tanggal ───────────────────────────────────────────────
  const todayEl = document.getElementById('today');
  if (todayEl) todayEl.innerText = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const productionDate = document.getElementById('productionDate');
  if (productionDate) {
    const n = new Date();
    productionDate.value = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  }

  // ── Numpad ────────────────────────────────────────────────
  let numpadValue = '';
  if (targetInput && numpadModal && numpadDisplay) {
    targetInput.addEventListener('click', () => {
      numpadValue = targetInput.value ? String(parseInt(targetInput.value)) : '';
      numpadDisplay.innerText = numpadValue || '0';
      numpadModal.classList.remove('hidden');
    });
    numpadModal.addEventListener('click', e => {
      if (e.target === numpadModal) numpadModal.classList.add('hidden');
    });
  }
  document.querySelectorAll('.numBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (numpadValue.length < 6) { numpadValue += btn.innerText; numpadDisplay.innerText = numpadValue; }
    });
  });
  document.getElementById('btnClear')?.addEventListener('click', () => { numpadValue=''; numpadDisplay.innerText='0'; });
  document.getElementById('btnDelete')?.addEventListener('click', () => { numpadValue=numpadValue.slice(0,-1); numpadDisplay.innerText=numpadValue||'0'; });
  document.getElementById('btnOk')?.addEventListener('click', () => {
    if (numpadValue !== '') { const val=parseInt(numpadValue); if(targetInput) targetInput.value=val; totalTarget=val; updateDisplay(); }
    numpadModal?.classList.add('hidden');
  });

  // ════════════════════════════════════════════════════════
  // POPUP — inject HTML+CSS ke DOM sekali saja
  // ════════════════════════════════════════════════════════
  function initPopups() {
    if (document.getElementById('dt-style')) return;

    const style = document.createElement('style');
    style.id = 'dt-style';
    style.textContent = `
      .dt-overlay {
        display:none; position:fixed; inset:0; z-index:9999;
        background:rgba(0,0,0,.65); backdrop-filter:blur(6px);
        align-items:center; justify-content:center;
      }
      .dt-overlay.dt-show { display:flex; animation:dtFade .2s ease; }
      @keyframes dtFade { from{opacity:0} to{opacity:1} }

      .dt-box {
        width:420px; border-radius:20px; overflow:hidden;
        background:#0d1117; box-shadow:0 32px 80px rgba(0,0,0,.75);
        animation:dtSlide .3s cubic-bezier(.4,0,.2,1);
      }
      @keyframes dtSlide { from{transform:translateY(20px);opacity:0} to{transform:none;opacity:1} }

      .dt-head {
        padding:22px 24px; display:flex; align-items:center; gap:16px;
        border-bottom:1px solid rgba(255,255,255,.07);
      }
      .dt-head-minor     { background:rgba(251,146,60,.07); }
      .dt-head-breakdown { background:rgba(248,113,113,.07); }

      .dt-head-icon { font-size:30px; line-height:1; }
      .dt-head-tag  {
        font-family:'DM Mono',monospace; font-size:10px;
        letter-spacing:.22em; text-transform:uppercase; margin-bottom:4px;
      }
      .dt-head-minor     .dt-head-tag { color:#fb923c; }
      .dt-head-breakdown .dt-head-tag { color:#f87171; }

      .dt-head-dur {
        font-family:'DM Mono',monospace; font-size:32px; font-weight:700;
        letter-spacing:.04em; color:#e2ddd5;
      }
      .dt-head-sub { font-family:'DM Mono',monospace; font-size:10px; color:#57534e; margin-top:3px; }

      .dt-body { padding:20px 24px; }
      .dt-label {
        display:block; font-family:'DM Mono',monospace; font-size:9px;
        letter-spacing:.18em; text-transform:uppercase; color:#57534e; margin-bottom:8px;
      }
      .dt-select, .dt-input {
        width:100%; padding:11px 14px;
        background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
        border-radius:10px; color:#e2ddd5;
        font-family:'DM Mono',monospace; font-size:12px;
        outline:none; transition:border-color .2s; appearance:none;
      }
      .dt-select {
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2357534e' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat:no-repeat; background-position:right 14px center; padding-right:36px;
      }
      .dt-select option { background:#0d1117; }
      .dt-select:focus, .dt-input:focus { border-color:rgba(255,255,255,.2); }
      .dt-mt { margin-top:14px; }

      .dt-foot {
        padding:14px 24px; display:flex; gap:10px;
        border-top:1px solid rgba(255,255,255,.06);
      }
      .dt-btn {
        flex:1; padding:11px; border-radius:10px; border:none; cursor:pointer;
        font-family:'DM Mono',monospace; font-size:11px; letter-spacing:.1em;
        text-transform:uppercase; transition:all .15s;
      }
      .dt-btn-close {
        background:rgba(255,255,255,.05); color:#57534e;
        border:1px solid rgba(255,255,255,.07);
      }
      .dt-btn-close:hover { background:rgba(255,255,255,.09); color:#a8a29e; }
      .dt-btn-minor {
        background:rgba(251,146,60,.12); color:#fb923c;
        border:1px solid rgba(251,146,60,.25);
      }
      .dt-btn-minor:hover { background:rgba(251,146,60,.22); }
      .dt-btn-breakdown {
        background:rgba(248,113,113,.12); color:#f87171;
        border:1px solid rgba(248,113,113,.25);
      }
      .dt-btn-breakdown:hover { background:rgba(248,113,113,.22); }

      /* Log tabel */
      #dt-log-wrap {
        display:none; margin-top:12px;
        border:1px solid rgba(255,255,255,.06); border-radius:12px; overflow:hidden;
      }
      #dt-log-wrap.show { display:block; }
      #dt-log-table { width:100%; border-collapse:collapse; }
      #dt-log-table th {
        padding:8px 12px; font-family:'DM Mono',monospace;
        font-size:9px; letter-spacing:.15em; text-transform:uppercase;
        color:#44403c; text-align:left; background:rgba(255,255,255,.02);
        border-bottom:1px solid rgba(255,255,255,.05);
      }
      #dt-log-table td {
        padding:9px 12px; font-family:'DM Mono',monospace; font-size:11px;
        border-bottom:1px solid rgba(255,255,255,.04);
      }
      #dt-log-table tr:last-child td { border-bottom:none; }

      /* Toast */
      #dt-toast {
        position:fixed; bottom:24px; left:50%;
        transform:translateX(-50%) translateY(16px);
        background:#13181f; border-radius:10px; padding:10px 22px;
        font-family:'DM Mono',monospace; font-size:12px; letter-spacing:.06em;
        border:1px solid rgba(255,255,255,.08); opacity:0;
        transition:all .3s; z-index:10000; white-space:nowrap;
        box-shadow:0 8px 32px rgba(0,0,0,.5); pointer-events:none;
      }
      #dt-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
    `;
    document.head.appendChild(style);

    // Popup Downtime
    const pm = document.createElement('div');
    pm.id = 'popup-downtime'; pm.className = 'dt-overlay';
    pm.innerHTML = `
      <div class="dt-box">
        <div class="dt-head dt-head-minor" id="popup-dt-head">
          <div class="dt-head-icon" id="popup-dt-icon">⚠️</div>
          <div>
            <div class="dt-head-tag" id="popup-dt-tag">Downtime — Mesin 2</div>
            <div class="dt-head-dur" id="popup-dt-dur">00:00</div>
            <div class="dt-head-sub" id="popup-dt-sub">Mesin berhenti melebihi 3 menit</div>
          </div>
        </div>
        <div class="dt-body">
          <label class="dt-label" id="popup-dt-label">Alasan Downtime</label>
          <select id="dt-reason" class="dt-select">
            <option value="">— Pilih alasan —</option>
          </select>
          <div class="dt-mt">
            <label class="dt-label">Catatan (opsional)</label>
            <input id="dt-note" class="dt-input" type="text" placeholder="Keterangan tambahan...">
          </div>
        </div>
        <div class="dt-foot">
          <button class="dt-btn dt-btn-close" id="dt-close-btn">✕ Tutup</button>
          <button class="dt-btn dt-btn-minor" id="dt-submit-btn">✓ Submit</button>
        </div>
      </div>`;
    document.body.appendChild(pm);

    // Toast
    const toast = document.createElement('div');
    toast.id = 'dt-toast';
    document.body.appendChild(toast);

    // Events
    document.getElementById('dt-close-btn').addEventListener('click',  () => submitDowntime(false));
    document.getElementById('dt-submit-btn').addEventListener('click', () => submitDowntime(true));
  }

  // ════════════════════════════════════════════════════════
  // FORMAT HELPERS
  // ════════════════════════════════════════════════════════
  function fmtMM(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }
  function formatTime(ms) {
    const s=Math.floor((ms||0)/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=s%60;
    return [h,m,sc].map(v=>String(v).padStart(2,'0')).join(':');
  }
  function formatEstimasi(ms) {
    const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=s%60;
    if (h>0) return `${h}j ${m}m ${sc}d`; if (m>0) return `${m}m ${sc}d`; return `${sc}d`;
  }

  // ════════════════════════════════════════════════════════
  // DOWNTIME TRACKER — inti logika baru
  // ════════════════════════════════════════════════════════

  // ── STOPWATCH MODEL ──────────────────────────────────────
  // lostWatch  = total ms yang sudah terhitung (pause/resume)
  // watchStart = timestamp saat terakhir di-resume (null = pause)
  // inDowntime = sudah >= 3 menit, masuk zona downtime
  //
  // count=0 → resume stopwatch
  // count=1 → pause stopwatch
  //
  // Display: selalu menampilkan lostWatch + elapsed sejak watchStart
  // Jika inDowntime: lostTime display beku, downtime display yang naik

  function getWatchElapsed() {
    // Total waktu stopwatch saat ini (termasuk sesi yang sedang berjalan)
    if (watchStart === null) return lostWatch;
    return lostWatch + (Date.now() - watchStart);
  }

  function onZeroDetected() {
    // Abaikan kalau stopwatch sudah berjalan (ESP32 kirim count=0 berulang)
    if (watchStart !== null) return;

    // Resume stopwatch dari nilai terakhir
    watchStart = Date.now();

    // Kalau sebelumnya sudah inDowntime (popup masih terbuka), langsung ke fase downtime
    if (inDowntime && !popupOpen) {
      openPopup(getWatchElapsed());
    }

    // Start/restart live timer
    clearInterval(liveTimer);
    liveTimer = setInterval(() => {
      const total = getWatchElapsed(); // total stopwatch dari awal

      if (!inDowntime) {
        if (total < LOST_LIMIT) {
          // ── FASE 1: Lost Time berjalan dari lostTimeAcc (misal 8 detik) + sesi ini
          if (lostTimeEl) lostTimeEl.innerText = formatTime(lostTimeAcc + total);

        } else {
          // ── Baru masuk downtime (pertama kali lewati 3 menit) ──
          inDowntime = true;
          if (lostTimeEl) lostTimeEl.innerText = formatTime(lostTimeAcc);
          if (!popupOpen) {
            openPopup(total);
            // Beritahu dashboard bahwa downtime sedang dimulai
            try { mqttClient.publish('oee/machine2/downtime-start', '1'); } catch(e) {}
          }
        }
      }

      if (inDowntime) {
        // ── FASE 2: Downtime berjalan ───────────────────
        const durEl = document.getElementById('popup-dt-dur');
        if (durEl) durEl.innerText = fmtMM(total);
        if (downtimeEl) downtimeEl.innerText = formatTime(downtimeAcc + total);
      }
    }, 500);
  }

  function onOneDetected() {
    // Pause stopwatch — simpan elapsed saat ini
    if (watchStart !== null) {
      lostWatch += Date.now() - watchStart;
      watchStart = null;
    }

    // Hentikan live timer
    clearInterval(liveTimer);
    liveTimer = null;

    // ── Commit lostWatch ke bucket yang tepat ─────────────
    if (!inDowntime) {
      // Sesi ini < 3 menit → masuk Lost Time
      lostTimeAcc += lostWatch;
      lostWatch    = 0;
      console.log(`[LostTime] commit ${(lostTimeAcc/1000).toFixed(1)}s total`);
    } else {
      // Sesi ini >= 3 menit & popup belum di-submit manual
      // Auto-commit ke downtime, TAPI simpan nilai agar popup bisa publish ke MQTT
      if (!popupSubmitted && lostWatch > 0) {
        committedDowntime = lostWatch; // simpan untuk dipakai submitDowntime
        downtimeAcc      += lostWatch;
        lostWatch         = 0;
        inDowntime        = false;
        console.log(`[Downtime] auto-commit ${(committedDowntime/1000).toFixed(1)}s, total=${(downtimeAcc/1000).toFixed(1)}s`);
      }
    }

    popupSubmitted = false;
    updateDisplay();
  }

  // ════════════════════════════════════════════════════════
  // POPUP ACTIONS
  // ════════════════════════════════════════════════════════

  function openPopup(elapsed) {
    popupOpen = true;

    // Tentukan tipe: minor (< 10 mnt) atau breakdown (>= 10 mnt)
    const isBreakdown = elapsed >= 10 * 60 * 1000;
    const head  = document.getElementById('popup-dt-head');
    const icon  = document.getElementById('popup-dt-icon');
    const tag   = document.getElementById('popup-dt-tag');
    const sub   = document.getElementById('popup-dt-sub');
    const label = document.getElementById('popup-dt-label');
    const btn   = document.getElementById('dt-submit-btn');
    const sel   = document.getElementById('dt-reason');

    if (isBreakdown) {
      head.className = 'dt-head dt-head-breakdown';
      icon.innerText = '🔴';
      tag.innerText  = 'Breakdown — Mesin 2';
      sub.innerText  = 'Mesin berhenti lebih dari 10 menit';
      label.innerText= 'Alasan Breakdown';
      btn.className  = 'dt-btn dt-btn-breakdown';
      sel.innerHTML  = `<option value="">— Pilih alasan —</option>` +
        BREAKDOWN_REASONS.map(r=>`<option value="${r}">${r}</option>`).join('');
    } else {
      head.className = 'dt-head dt-head-minor';
      icon.innerText = '⚠️';
      tag.innerText  = 'Downtime Minor — Mesin 2';
      sub.innerText  = 'Mesin berhenti melebihi 3 menit';
      label.innerText= 'Alasan Downtime Minor';
      btn.className  = 'dt-btn dt-btn-minor';
      sel.innerHTML  = `<option value="">— Pilih alasan —</option>` +
        MINOR_REASONS.map(r=>`<option value="${r}">${r}</option>`).join('');
    }

    // Reset field
    sel.value = '';
    document.getElementById('dt-note').value = '';
    document.getElementById('popup-dt-dur').innerText = fmtMM(elapsed);

    document.getElementById('popup-downtime').classList.add('dt-show');
  }

  function closePopup() {
    document.getElementById('popup-downtime')?.classList.remove('dt-show');
    popupOpen = false;
  }

  // requireReason=true → Submit tombol, requireReason=false → Tutup tombol
  function submitDowntime(requireReason) {
    const reason = document.getElementById('dt-reason')?.value;
    const note   = document.getElementById('dt-note')?.value || '';

    if (requireReason && !reason) {
      showToast('⚠️ Pilih alasan terlebih dahulu', '#f87171');
      return;
    }

    // Pause stopwatch dulu (jika masih berjalan) untuk hitung total
    if (watchStart !== null) {
      lostWatch += Date.now() - watchStart;
      watchStart = null;
      clearInterval(liveTimer);
      liveTimer  = null;
    }

    // Total durasi: jika lostWatch > 0 (mesin masih mati saat submit),
    // pakai lostWatch. Jika sudah 0 (mesin sudah ON, auto-commit sudah terjadi),
    // pakai committedDowntime yang disimpan oleh onOneDetected.
    const totalDur = lostWatch > 0 ? lostWatch : committedDowntime;

    // Commit ke downtime hanya jika belum di-auto-commit
    if (lostWatch > 0) {
      downtimeAcc += totalDur;
    }
    // Reset
    lostWatch         = 0;
    committedDowntime = 0;
    inDowntime        = false;
    popupSubmitted    = true;
    closePopup();

    // Jika mesin masih mati saat submit (sensor OFF),
    // langsung resume stopwatch dari 0 agar lostTime display naik lagi dari lostTimeAcc
    const statusEl = document.getElementById('sensorStatus');
    if (statusEl && statusEl.innerText === 'OFF') {
      watchStart = Date.now();
      clearInterval(liveTimer);
      liveTimer = setInterval(() => {
        const total = getWatchElapsed();
        if (total < LOST_LIMIT) {
          if (lostTimeEl) lostTimeEl.innerText = formatTime(lostTimeAcc + total);
        } else {
          inDowntime = true;
          if (lostTimeEl) lostTimeEl.innerText = formatTime(lostTimeAcc);
          if (!popupOpen) openPopup(total);
        }
        if (inDowntime) {
          const durEl = document.getElementById('popup-dt-dur');
          if (durEl) durEl.innerText = fmtMM(total);
          if (downtimeEl) downtimeEl.innerText = formatTime(downtimeAcc + total);
        }
      }, 500);
    }

    const label = reason || '—';
    addLog('downtime', label, note, totalDur);

    // Kirim event ke backend via MQTT agar tersimpan ke database
    try {
      mqttClient.publish('oee/machine2/downtime', JSON.stringify({
        alasan:    label,
        catatan:   note,
        durasi_ms: totalDur,
      }));
    } catch(e) { console.warn('MQTT publish downtime error:', e); }

    showToast(requireReason ? '✓ Downtime tercatat' : '✓ Ditutup tanpa alasan',
              requireReason ? '#fb923c' : '#78716c');

    updateDisplay();
  }

  // ════════════════════════════════════════════════════════
  // LOG
  // ════════════════════════════════════════════════════════
  function addLog(type, reason, note, durMs) {
    dtLog.unshift({
      no:    dtLog.length + 1,
      waktu: new Date().toLocaleTimeString('id-ID'),
      type,
      reason,
      dur:   fmtMM(durMs || 0),
      note:  note || '—',
    });
    renderLog();
  }

  function renderLog() {
    const wrap = document.getElementById('dt-log-wrap');
    if (!wrap) return;
    if (!dtLog.length) { wrap.classList.remove('show'); return; }
    wrap.classList.add('show');

    const rows = dtLog.map((d, i) => `
      <tr>
        <td style="color:#44403c">${dtLog.length - i}</td>
        <td style="color:#57534e">${d.waktu}</td>
        <td>
          <span style="padding:2px 8px;border-radius:5px;font-size:9px;letter-spacing:.1em;
            background:rgba(251,146,60,.1);color:#fb923c;
            border:1px solid rgba(251,146,60,.25)">DOWNTIME</span>
        </td>
        <td style="color:#e2ddd5">${d.reason}</td>
        <td style="color:#4ade80">${d.dur}</td>
        <td style="color:#57534e">${d.note}</td>
      </tr>`).join('');

    wrap.innerHTML = `
      <table id="dt-log-table">
        <thead><tr>
          <th>#</th><th>Waktu</th><th>Tipe</th><th>Alasan</th><th>Durasi</th><th>Catatan</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ════════════════════════════════════════════════════════
  // TOAST
  // ════════════════════════════════════════════════════════
  function showToast(msg, color = '#4ade80') {
    const t = document.getElementById('dt-toast');
    if (!t) return;
    t.innerText = msg; t.style.color = color; t.style.borderColor = color + '40';
    t.classList.add('show'); clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3000);
  }

  // ════════════════════════════════════════════════════════
  // MQTT
  // ════════════════════════════════════════════════════════
  const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

  mqttClient.on('connect', () => {
    console.log('✅ MQTT Connected (Mesin 2)');
    mqttClient.subscribe('oee/machine2/count');
    mqttClient.subscribe('oee/machine2/setup');
    mqttClient.subscribe('oee/machine2/lost');
    mqttClient.subscribe('oee/machine2/runtime');
    mqttClient.subscribe('oee/machine2/target');
    mqttClient.subscribe('oee/machine2/reset');
  });

  mqttClient.on('message', (topic, message) => {
    const payload = message.toString().trim();

    if (topic === 'oee/machine2/count') {
      if (payload === '1') {
        inputOne++;
        if (sensorStatus) sensorStatus.innerText = 'ON';
        onOneDetected();   // updateDisplay() dipanggil di dalam onOneDetected
      } else {
        inputZero++;
        if (sensorStatus) sensorStatus.innerText = 'OFF';
        if (inputZeroEl) inputZeroEl.innerText = inputZero;
        onZeroDetected();
      }
      return; // keluar lebih awal — display diurus masing-masing
    }

    if (topic === 'oee/machine2/setup')   { setupTime  = parseInt(payload) || 0; }
    if (topic === 'oee/machine2/runtime') { runtime    = parseInt(payload) || 0; }
    if (topic === 'oee/machine2/target')  {
      const val = parseInt(payload) || 0;
      totalTarget = val;
      if (targetInput) targetInput.value = val > 0 ? val : '';
    }
    if (topic === 'oee/machine2/reset') {
      doReset();
      console.log('🔄 RESET received (Mesin 2)');
    }

    updateDisplay(); // hanya dipanggil untuk topic selain count
  });

  // ════════════════════════════════════════════════════════
  // RESET
  // ════════════════════════════════════════════════════════
  function doReset() {
    inputOne = inputZero = setupTime = runtime = totalTarget = 0;
    lostTimeAcc = downtimeAcc = 0;
    lostWatch = 0; watchStart = null; inDowntime = false; committedDowntime = 0;
    clearInterval(liveTimer); liveTimer = null;
    popupOpen = false; popupSubmitted = false;
    dtLog = [];
    closePopup();
    if (targetInput) targetInput.value = '';
    renderLog();
    updateDisplay();
  }

  // ════════════════════════════════════════════════════════
  // TOMBOL
  // ════════════════════════════════════════════════════════
  document.getElementById('btnStart')?.addEventListener('click', () => { mqttClient.publish('oee/machine2/status','ON'); });
  document.getElementById('btnStop')?.addEventListener('click',  () => { mqttClient.publish('oee/machine2/status','OFF'); });
  document.getElementById('btnReset')?.addEventListener('click', () => {
    if (!confirm('⚠️ Reset semua data produksi Mesin 2?')) return;
    doReset();
    if (totalTargetEl) totalTargetEl.innerText = '0';
    mqttClient.publish('oee/machine2/reset','RESET',{retain:false});
    updateDisplay();
  });
  document.getElementById('btnSaveSetup')?.addEventListener('click', () => {
    const target  = parseInt(targetInput?.value) || 0;
    const date    = document.getElementById('productionDate')?.value || '';
    const shift   = document.getElementById('shift')?.value || '1';
    const product = document.getElementById('productName')?.value || '';
    if (!target) { alert('⚠️ Masukkan Target Produksi terlebih dahulu!'); return; }
    totalTarget = target;
    mqttClient.publish('oee/machine2/target', String(target), {retain:true});
    alert(`✅ Setup tersimpan!\nTarget : ${target} pcs\nEst.   : ${formatEstimasi(target*MS_PER_PCS)}\nProduk : ${product||'-'}\nShift  : ${shift}`);
    updateDisplay();
  });
  document.getElementById('btnDownload')?.addEventListener('click', () => {
    const date    = document.getElementById('productionDate')?.value || new Date().toISOString().split('T')[0];
    const shift   = document.getElementById('shift')?.value || '1';
    const product = document.getElementById('productName')?.value || '-';
    const rows = [
      ['LAPORAN PRODUKSI MESIN PACKING #1'],
      ['Tanggal',date],['Shift',`Shift ${shift}`],['Produk',product],
      ['Waktu per pcs',`${MS_PER_PCS/1000} detik`],[],
      ['Parameter','Nilai'],
      ['Target Produksi',totalTarget],
      ['Est. Waktu Target',formatEstimasi(totalTarget*MS_PER_PCS)],
      ['Input Good (1)',inputOne],['Input No Obj (0)',inputZero],
      ['Total Pieces',inputOne+inputZero],
      ['Progress (%)',totalTarget>0?Math.round(((inputOne+inputZero)/totalTarget)*100)+'%':'0%'],
      ['Setup Time',formatTime(setupTime)],
      ['Lost Time (< 3 mnt)',formatTime(lostTimeAcc)],
      ['Downtime (>= 3 mnt)',formatTime(downtimeAcc)],
      ['Runtime',formatTime(runtime)],[],
      ['LOG DOWNTIME'],
      ['No','Waktu','Tipe','Alasan','Durasi','Catatan'],
      ...dtLog.map(d=>[d.no,d.waktu,d.type.toUpperCase(),d.reason,d.dur,d.note]),
    ];
    const ws=XLSX.utils.aoa_to_sheet(rows); const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Laporan Mesin 2');
    XLSX.writeFile(wb,`Laporan_Mesin2_${date}_Shift${shift}.xlsx`);
  });

  // ════════════════════════════════════════════════════════
  // UPDATE DISPLAY
  // ════════════════════════════════════════════════════════
  function updateDisplay() {
    if (inputOneEl)    inputOneEl.innerText    = inputOne;
    if (inputZeroEl)   inputZeroEl.innerText   = inputZero;
    if (totalTargetEl) totalTargetEl.innerText = totalTarget;
    if (setupTimeEl)   setupTimeEl.innerText   = formatTime(setupTime);
    // lostTime & downtime dihandle oleh liveTimer saat berjalan
    // updateDisplay hanya menulis saat stopwatch sedang pause
    // Downtime selalu tampil nilai terkini
    if (downtimeEl) downtimeEl.innerText = formatTime(downtimeAcc);

    // lostTime: hanya update saat stopwatch pause (liveTimer yang handle saat berjalan)
    if (watchStart === null) {
      // Tampil lostTimeAcc + sisa lostWatch yang belum di-commit
      // Normalnya lostWatch = 0 setelah commit, jadi tampil lostTimeAcc saja
      if (lostTimeEl) lostTimeEl.innerText = formatTime(lostTimeAcc + lostWatch);
    }
    if (runtimeEl) runtimeEl.innerText = formatTime(runtime);
    const estEl = document.getElementById('estimasiWaktu');
    if (estEl) estEl.innerText = totalTarget>0 ? formatEstimasi(totalTarget*MS_PER_PCS) : '—';
  }

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════
  initPopups();

  if (!document.getElementById('dt-log-wrap')) {
    const w = document.createElement('div'); w.id='dt-log-wrap';
    const a = document.getElementById('downtime-section') || document.body;
    a.appendChild(w);
  }

  console.log('✅ controle_mesin2.js loaded');
  console.log('   Lost Time : < 3 menit (realtime display, simpan saat mesin hidup)');
  console.log('   Downtime  : >= 3 menit (total dari detik 0, simpan saat submit)');
});