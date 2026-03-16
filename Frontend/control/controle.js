// controle.js — Control Panel Mesin Packing #1
// ─────────────────────────────────────────────
// LOGIKA SENSOR ON/OFF:
//   • SENSOR OFF → ESP32 tetap jalan (runtime terus), RELAY mati
//     → semua count (input1/0), downtime, minor breakdown BERHENTI
//   • SENSOR ON  → relay hidup, semua tracking normal kembali
//
// LOGIKA DOWNTIME:
//  Fase 1 — 0:00 s/d 2:59  → Minor Breakdown realtime, tidak ada popup
//  Fase 2 — 3:00 s/d 9:59  → Popup "Minor Breakdown", durasi → minorBreakdownAcc
//  Fase 3 — >= 10:00        → Popup upgrade ke "Breakdown", durasi → downtimeAcc
//
// LOGIKA RESTART & RESET (FIXED v2):
//  • btnRestartESP → publish 'restarted' DENGAN retain:true → restart ESP32 → refresh
//    Dashboard akan finalize row lama, set awaitingNewSetup=true
//    INSERT row baru HANYA terjadi saat btnSaveSetup ditekan (bukan saat restart)
//  • btnReset      → reset data/tampilan saja, TARGET tidak ikut di-reset
//    Tidak memicu INSERT DB apapun
//  • btnSaveSetup  → publish setup-info (shift, produk, tanggal, target)
//    Dashboard akan INSERT row baru jika awaitingNewSetup=true
//
// FIX v2:
//  - retain:true pada publish 'restarted' agar dashboard pasti terima meski MQTT reconnect
//  - Setelah dashboard terima, retained message di-clear oleh dashboard
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ── DOM refs ─────────────────────────────────────────────
  const inputOneEl       = document.getElementById('inputOne');
  const inputZeroEl      = document.getElementById('inputZero');
  const totalTargetEl    = document.getElementById('totalTarget');
  const setupTimeEl      = document.getElementById('setupTime');
  const minorBreakdownEl = document.getElementById('minorBreakdown');
  const runtimeEl        = document.getElementById('runtime');
  const downtimeEl       = document.getElementById('downtime');
  const sensorStatus     = document.getElementById('sensorStatus');
  const targetInput      = document.getElementById('targetInput');
  const numpadModal      = document.getElementById('numpadModal');
  const numpadDisplay    = document.getElementById('numpadDisplay');
  const relayBadge       = document.getElementById('relayBadge');

  // ── Konstanta ─────────────────────────────────────────────
  const MS_PER_PCS      = 2069;
  const POPUP_LIMIT     = 3  * 60 * 1000;
  const BREAKDOWN_LIMIT = 10 * 60 * 1000;

  const BREAKDOWN_INDIVIDUAL = ['Seal', 'Coding', 'Vakum Bag', 'Capit', 'Weighting', 'Nirogen', 'MD'];
  const BREAKDOWN_SHARED     = ['Kompresor', 'Elevator', 'Roaster', 'DLL'];

  // ── State produksi ────────────────────────────────────────
  let inputOne    = 0;
  let inputZero   = 0;
  let totalTarget = 0;
  let setupTime   = 0;
  let runtime     = 0;

  // ── Akumulasi waktu ───────────────────────────────────────
  let minorBreakdownAcc = 0;
  let downtimeAcc       = 0;

  // ── Stopwatch ─────────────────────────────────────────────
  let minorBreakdownWatch = 0;
  let watchStart          = null;
  let inDowntime          = false;

  // ── State tracker ─────────────────────────────────────────
  let liveTimer         = null;
  let popupOpen         = false;
  let popupSubmitted    = false;
  let committedDowntime = 0;

  // ── State sensor relay ────────────────────────────────────
  let sensorEnabled = false;

  // ── Log event ─────────────────────────────────────────────
  let dtLog = [];

  // ════════════════════════════════════════════════════════
  // PERSIST STATE — simpan/load ke localStorage
  // ════════════════════════════════════════════════════════
  const STORAGE_KEY = 'oee_mesin1_state';

  function saveState() {
    const snap = {
      inputOne, inputZero, totalTarget, setupTime, runtime,
      minorBreakdownAcc, downtimeAcc,
      minorBreakdownWatch: minorBreakdownWatch + (watchStart !== null ? Date.now() - watchStart : 0),
      dtLog,
      sensorEnabled,
      savedAt: Date.now(),
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snap)); } catch(e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      inputOne            = snap.inputOne            || 0;
      inputZero           = snap.inputZero           || 0;
      totalTarget         = snap.totalTarget         || 0;
      setupTime           = snap.setupTime           || 0;
      runtime             = snap.runtime             || 0;
      minorBreakdownAcc   = snap.minorBreakdownAcc   || 0;
      downtimeAcc         = snap.downtimeAcc         || 0;
      minorBreakdownWatch = snap.minorBreakdownWatch || 0;
      dtLog               = snap.dtLog               || [];
      sensorEnabled       = snap.sensorEnabled === true;
      console.log('[Mesin1] State loaded — sensorEnabled=' + sensorEnabled);
    } catch(e) { console.warn('[Mesin1] Gagal load state:', e); }
  }

  function clearState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  }

  // ── Bersihkan sisa session id DB yang mungkin tertinggal ──
  ;(function cleanLegacyDbKey() {
    const legacy = ['oee_mesin1_session_id'];
    legacy.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  })();

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
  document.getElementById('btnClear')?.addEventListener('click',  () => { numpadValue = ''; numpadDisplay.innerText = '0'; });
  document.getElementById('btnDelete')?.addEventListener('click', () => { numpadValue = numpadValue.slice(0, -1); numpadDisplay.innerText = numpadValue || '0'; });
  document.getElementById('btnOk')?.addEventListener('click', () => {
    if (numpadValue !== '') { const val = parseInt(numpadValue); if (targetInput) targetInput.value = val; totalTarget = val; updateDisplay(); }
    numpadModal?.classList.add('hidden');
  });

  // ════════════════════════════════════════════════════════
  // RELAY BADGE UI
  // ════════════════════════════════════════════════════════
  function updateRelayBadge(isOn) {
    if (!relayBadge) return;
    if (isOn) {
      relayBadge.innerText = '● SENSOR ON';
      relayBadge.className = 'px-4 py-1.5 rounded-full text-sm font-mono font-semibold tracking-widest ' +
        'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 transition-all duration-300';
    } else {
      relayBadge.innerText = '● SENSOR OFF';
      relayBadge.className = 'px-4 py-1.5 rounded-full text-sm font-mono font-semibold tracking-widest ' +
        'bg-red-500/15 text-red-400 border border-red-500/30 transition-all duration-300';
    }
    if (sensorStatus) sensorStatus.innerText = isOn ? 'ON' : 'OFF';
  }

  // ════════════════════════════════════════════════════════
  // SENSOR ON / OFF HANDLER
  // ════════════════════════════════════════════════════════

  function handleSensorOn() {
    sensorEnabled = true;
    updateRelayBadge(true);
    showToast('● Sensor ON — Tracking aktif', '#4ade80');
    console.log('[Mesin1] Sensor ON');
  }

  function handleSensorOff() {
    sensorEnabled = false;
    updateRelayBadge(false);
    freezeAllTracking();
    showToast('■ Sensor OFF — Tracking dihentikan', '#f87171');
    console.log('[Mesin1] Sensor OFF — semua tracking di-freeze');
  }

  function freezeAllTracking() {
    clearInterval(liveTimer);
    liveTimer = null;
    if (watchStart !== null) {
      minorBreakdownWatch += Date.now() - watchStart;
      watchStart = null;
    }
    if (minorBreakdownWatch > 0) {
      if (inDowntime) { downtimeAcc += minorBreakdownWatch; }
      else            { minorBreakdownAcc += minorBreakdownWatch; }
      minorBreakdownWatch = 0;
    }
    inDowntime        = false;
    committedDowntime = 0;
    popupSubmitted    = false;
    if (popupOpen) {
      closePopup();
      console.log('[Mesin1] Popup ditutup karena sensor OFF');
    }
    if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc);
    if (downtimeEl)       downtimeEl.innerText       = formatTime(downtimeAcc);
    updateDisplay();
    console.log(`[Mesin1] ⏸ Freeze → minor=${(minorBreakdownAcc/1000).toFixed(1)}s  downtime=${(downtimeAcc/1000).toFixed(1)}s`);
  }

  // ════════════════════════════════════════════════════════
  // POPUP
  // ════════════════════════════════════════════════════════
  document.getElementById('dt-submit-btn')?.addEventListener('click', () => submitDowntime(true));

  // ════════════════════════════════════════════════════════
  // FORMAT HELPERS
  // ════════════════════════════════════════════════════════
  function fmtMM(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }
  function formatTime(ms) {
    const s = Math.floor((ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
    return [h, m, sc].map(v => String(v).padStart(2,'0')).join(':');
  }
  function formatEstimasi(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
    if (h > 0) return `${h}j ${m}m ${sc}d`; if (m > 0) return `${m}m ${sc}d`; return `${sc}d`;
  }

  // ════════════════════════════════════════════════════════
  // DOWNTIME TRACKER
  // ════════════════════════════════════════════════════════

  function getWatchElapsed() {
    if (watchStart === null) return minorBreakdownWatch;
    return minorBreakdownWatch + (Date.now() - watchStart);
  }

  function upgradePopupToBreakdown() {
    inDowntime = true;
    const head       = document.getElementById('popup-dt-head');
    const icon       = document.getElementById('popup-dt-icon');
    const tag        = document.getElementById('popup-dt-tag');
    const sub        = document.getElementById('popup-dt-sub');
    const label      = document.getElementById('popup-dt-label');
    const btn        = document.getElementById('dt-submit-btn');
    const reasonWrap = document.getElementById('dt-reason-wrap');

    head.style.background = 'rgba(248,113,113,.07)';
    tag.style.color        = '#f87171';
    icon.innerText  = '🔴';
    tag.innerText   = 'Breakdown — Mesin 1';
    sub.innerText   = 'Mesin berhenti ≥ 10 menit — pilih alasan breakdown';
    label.innerText = 'Alasan Breakdown';
    btn.className   = 'dt-btn dt-btn-breakdown';

    reasonWrap.innerHTML = `
      <select id="dt-reason"
        style="width:100%; padding:11px 14px; box-sizing:border-box;
               background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
               border-radius:10px; color:#e2ddd5;
               font-family:'DM Mono',monospace; font-size:16px;
               outline:none; appearance:none; cursor:pointer;">
        <option value="" style="background:#0d1117">— Pilih alasan —</option>
        <optgroup label="Per Mesin">
          ${BREAKDOWN_INDIVIDUAL.map(r => `<option value="${r}" style="background:#0d1117">${r}</option>`).join('')}
        </optgroup>
        <optgroup label="Shared (ambil durasi terlama)">
          ${BREAKDOWN_SHARED.map(r => `<option value="SHARED:${r}" style="background:#0d1117">${r} ⚡</option>`).join('')}
        </optgroup>
      </select>`;

    if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc);

    try { mqttClient.publish('oee/machine1/downtime-start', '1'); } catch(e) {}
    disableSubmitBtn();
    console.log('[Mesin1] Popup upgraded to Breakdown at', fmtMM(getWatchElapsed()));
  }

  function onZeroDetected() {
    if (!sensorEnabled) return;
    if (watchStart !== null) return;
    watchStart = Date.now();
    clearInterval(liveTimer);
    liveTimer = setInterval(() => {
      if (!sensorEnabled) { clearInterval(liveTimer); liveTimer = null; return; }
      const total = getWatchElapsed();
      if (popupOpen && !inDowntime && total >= BREAKDOWN_LIMIT) upgradePopupToBreakdown();
      if (!inDowntime) {
        if (total < POPUP_LIMIT) {
          if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc + total);
        } else if (!popupOpen) {
          if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc);
          openPopup(total);
          disableSubmitBtn();
        }
      }
      if (popupOpen) {
        const durEl = document.getElementById('popup-dt-dur');
        if (durEl) durEl.innerText = fmtMM(total);
      }
      if (inDowntime) {
        if (downtimeEl) downtimeEl.innerText = formatTime(downtimeAcc + total);
      }
    }, 500);
  }

  function onOneDetected() {
    if (!sensorEnabled) return;
    if (watchStart !== null) { minorBreakdownWatch += Date.now() - watchStart; watchStart = null; }
    clearInterval(liveTimer); liveTimer = null;
    if (popupOpen) { enableSubmitBtn(); return; }
    if (!inDowntime) {
      minorBreakdownAcc += minorBreakdownWatch;
      minorBreakdownWatch = 0;
      console.log(`[MinorBreakdown] commit ${(minorBreakdownAcc/1000).toFixed(1)}s total`);
      try { mqttClient.publish('oee/machine1/minor', JSON.stringify({ minor_total: minorBreakdownAcc }), { retain: false }); } catch(e) {}
    } else {
      if (!popupSubmitted && minorBreakdownWatch > 0) {
        committedDowntime = minorBreakdownWatch;
        downtimeAcc      += minorBreakdownWatch;
        minorBreakdownWatch = 0;
        inDowntime        = false;
        console.log(`[Downtime] auto-commit ${(committedDowntime/1000).toFixed(1)}s, total=${(downtimeAcc/1000).toFixed(1)}s`);
        try {
          mqttClient.publish('oee/machine1/downtime', JSON.stringify({
            alasan: 'auto-commit', durasi_ms: committedDowntime,
            downtime_total: downtimeAcc, minor_total: minorBreakdownAcc,
          }), { retain: false });
        } catch(e) {}
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
    const head       = document.getElementById('popup-dt-head');
    const icon       = document.getElementById('popup-dt-icon');
    const tag        = document.getElementById('popup-dt-tag');
    const sub        = document.getElementById('popup-dt-sub');
    const label      = document.getElementById('popup-dt-label');
    const btn        = document.getElementById('dt-submit-btn');
    head.style.background = 'rgba(251,146,60,.07)';
    tag.style.color        = '#fb923c';
    icon.innerText  = '⚠️';
    tag.innerText   = 'Minor Breakdown — Mesin 1';
    sub.innerText   = 'Mesin berhenti 3–9 menit (masuk Minor Breakdown)';
    label.innerText = 'Alasan Berhenti';
    btn.className   = 'dt-btn dt-btn-minor';
    const reasonWrap = document.getElementById('dt-reason-wrap');
    reasonWrap.innerHTML = `<textarea id="dt-reason" rows="2"
      inputmode="text" enterkeyhint="done"
      placeholder="Ketik alasan berhenti..."
      autocomplete="off"
      style="width:100%; padding:11px 14px; box-sizing:border-box;
             background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
             border-radius:10px; color:#e2ddd5;
             font-family:'DM Mono',monospace; font-size:16px;
             outline:none; resize:none; height:72px; line-height:1.5;
             -webkit-user-select:text; user-select:text;
             touch-action:manipulation; cursor:text;">
    </textarea>`;
    document.getElementById('popup-dt-dur').innerText = fmtMM(elapsed);
    const overlay = document.getElementById('popup-downtime');
    overlay.style.visibility   = 'visible';
    overlay.style.opacity      = '1';
    overlay.style.pointerEvents = 'auto';
    disableSubmitBtn();
    setTimeout(() => { const inp = document.getElementById('dt-reason'); if (inp) inp.focus(); }, 100);
  }

  function closePopup() {
    const overlay = document.getElementById('popup-downtime');
    if (overlay) {
      overlay.style.visibility   = 'hidden';
      overlay.style.opacity      = '0';
      overlay.style.pointerEvents = 'none';
    }
    popupOpen = false;
  }

  function enableSubmitBtn() {
    const btn = document.getElementById('dt-submit-btn');
    if (!btn) return;
    btn.disabled      = false;
    btn.style.opacity = '1';
    btn.style.cursor  = 'pointer';
    btn.className = inDowntime ? 'dt-btn dt-btn-breakdown' : 'dt-btn dt-btn-minor';
    btn.innerText = '✓ Submit';
  }

  function disableSubmitBtn() {
    const btn = document.getElementById('dt-submit-btn');
    if (!btn) return;
    btn.disabled      = true;
    btn.style.opacity = '0.4';
    btn.style.cursor  = 'not-allowed';
    btn.innerText = '⏳ Menunggu Mesin Jalan...';
  }

  function submitDowntime(requireReason) {
    const reason = document.getElementById('dt-reason')?.value || '';
    if (requireReason && !reason) { showToast('⚠️ Ketik alasan terlebih dahulu', '#f87171'); return; }
    if (watchStart !== null) { minorBreakdownWatch += Date.now() - watchStart; watchStart = null; clearInterval(liveTimer); liveTimer = null; }
    const totalDur  = minorBreakdownWatch > 0 ? minorBreakdownWatch : committedDowntime;
    const _isShared = reason && reason.startsWith('SHARED:');
    if (minorBreakdownWatch > 0) {
      if (inDowntime) { if (_isShared) { downtimeAcc = totalDur; } else { downtimeAcc += totalDur; } }
      else { minorBreakdownAcc += totalDur; }
    }
    minorBreakdownWatch = 0; committedDowntime = 0; inDowntime = false; popupSubmitted = true;
    closePopup();
    const isShared   = _isShared;
    const cleanLabel = isShared ? reason.replace('SHARED:', '') : (reason || '—');
    const logType    = (totalDur >= BREAKDOWN_LIMIT) ? 'downtime' : 'minorbreakdown';
    addLog(logType, cleanLabel + (isShared ? ' ⚡' : ''), '', totalDur);
    if (logType === 'downtime') {
      if (isShared) {
        try { mqttClient.publish('oee/shared-downtime', JSON.stringify({ alasan: cleanLabel, durasi_ms: totalDur, dari_mesin: 1 }), { retain: false }); } catch(e) {}
      } else {
        try { mqttClient.publish('oee/machine1/downtime', JSON.stringify({ alasan: cleanLabel, durasi_ms: totalDur, downtime_total: downtimeAcc, minor_total: minorBreakdownAcc })); } catch(e) {}
      }
    } else {
      try { mqttClient.publish('oee/machine1/minor', JSON.stringify({ minor_total: minorBreakdownAcc }), { retain: false }); } catch(e) {}
    }
    showToast(requireReason ? '✓ Tersimpan' : '✓ Ditutup tanpa alasan', requireReason ? '#fb923c' : '#78716c');
    updateDisplay();
  }

  // ════════════════════════════════════════════════════════
  // LOG
  // ════════════════════════════════════════════════════════
  function addLog(type, reason, note, durMs) {
    dtLog.unshift({ no: dtLog.length + 1, waktu: new Date().toLocaleTimeString('id-ID'), type, reason, dur: fmtMM(durMs || 0), note: note || '—' });
    renderLog();
  }

  function renderLog() {
    const wrap = document.getElementById('dt-log-wrap');
    if (!wrap) return;
    if (!dtLog.length) { wrap.classList.remove('show'); return; }
    wrap.classList.add('show');
    const rows = dtLog.map((d, i) => {
      const isDown  = d.type === 'downtime';
      const color   = isDown ? '#f87171' : '#fb923c';
      const tagText = isDown ? 'DOWNTIME' : 'MINOR BREAKDOWN';
      return `<tr>
        <td style="color:#44403c">${dtLog.length - i}</td>
        <td style="color:#57534e">${d.waktu}</td>
        <td><span style="padding:2px 8px;border-radius:5px;font-size:9px;letter-spacing:.1em;
          background:${color}1a;color:${color};border:1px solid ${color}40">${tagText}</span></td>
        <td style="color:#e2ddd5">${d.reason}</td>
        <td style="color:#4ade80">${d.dur}</td>
        <td style="color:#57534e">${d.note}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<table id="dt-log-table">
      <thead><tr><th>#</th><th>Waktu</th><th>Tipe</th><th>Alasan</th><th>Durasi</th><th>Catatan</th></tr></thead>
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
    console.log('✅ MQTT Connected (Mesin 1)');
    mqttClient.subscribe('oee/machine1/count');
    mqttClient.subscribe('oee/machine1/setup');
    mqttClient.subscribe('oee/machine1/lost');
    mqttClient.subscribe('oee/machine1/runtime');
    mqttClient.subscribe('oee/machine1/target');
    mqttClient.subscribe('oee/machine1/reset');
    mqttClient.subscribe('oee/machine1/relay-status');
    mqttClient.subscribe('oee/machine1/setup-info');
    mqttClient.subscribe('oee/shared-downtime');
  });

  mqttClient.on('message', (topic, message) => {
    const payload = message.toString().trim();

    if (topic === 'oee/machine1/relay-status') {
      if (payload === 'ON')  handleSensorOn();
      if (payload === 'OFF') handleSensorOff();
      return;
    }

    if (topic === 'oee/machine1/count') {
      if (!sensorEnabled) return;
      if (payload === '1') {
        inputOne++;
        if (sensorStatus) sensorStatus.innerText = 'ON';
        onOneDetected();
      } else {
        inputZero++;
        if (sensorStatus) sensorStatus.innerText = 'OFF';
        if (inputZeroEl) inputZeroEl.innerText = inputZero;
        onZeroDetected();
      }
      updateDisplay();
      return;
    }

    if (topic === 'oee/machine1/setup')   { setupTime  = parseInt(payload) || 0; }
    if (topic === 'oee/machine1/runtime') { runtime    = parseInt(payload) || 0; }
    if (topic === 'oee/machine1/target')  {
      const val = parseInt(payload) || 0;
      totalTarget = val;
      if (targetInput) targetInput.value = val > 0 ? val : '';
    }
    if (topic === 'oee/machine1/reset') {
      doReset();
      console.log('🔄 RESET received (Mesin 1)');
    }

    if (topic === 'oee/shared-downtime') {
      try {
        const ev = JSON.parse(payload);
        if (ev.dari_mesin !== 1) {
          const durasi = ev.durasi_ms || 0;
          if (durasi > downtimeAcc) {
            downtimeAcc = durasi;
            addLog('downtime', ev.alasan + ' ⚡ (M2: ' + fmtMM(durasi) + ')', '', durasi);
            console.log(`[M1] Shared downtime SET ke ${(durasi/1000).toFixed(0)}s`);
            updateDisplay();
          }
        }
      } catch(e) { console.warn('⚠️ shared-downtime parse error:', e); }
    }

    updateDisplay();
  });

  // ════════════════════════════════════════════════════════
  // RESET — hanya data & tampilan, TARGET TETAP, tidak INSERT DB
  // ════════════════════════════════════════════════════════
  function doReset() {
    const savedTarget = totalTarget;

    inputOne = inputZero = setupTime = runtime = 0;
    minorBreakdownAcc = downtimeAcc = 0;
    minorBreakdownWatch = 0; watchStart = null; inDowntime = false; committedDowntime = 0;
    clearInterval(liveTimer); liveTimer = null;
    popupOpen = false; popupSubmitted = false;
    dtLog = [];
    closePopup();

    totalTarget = savedTarget;
    clearState();
    saveState();

    if (targetInput) targetInput.value = savedTarget > 0 ? savedTarget : '';
    renderLog();
    updateDisplay();
  }

  // ════════════════════════════════════════════════════════
  // TOMBOL
  // ════════════════════════════════════════════════════════

  document.getElementById('btnSensorOn')?.addEventListener('click', () => {
    mqttClient.publish('oee/machine1/relay', 'ON');
    handleSensorOn();
    console.log('[CONTROL] Relay ON sent → Sensor ON');
  });

  document.getElementById('btnSensorOff')?.addEventListener('click', () => {
    mqttClient.publish('oee/machine1/relay', 'OFF');
    handleSensorOff();
    console.log('[CONTROL] Relay OFF sent → Sensor OFF');
  });

  // ─────────────────────────────────────────────────────────
  // btnRestartESP — URUTAN FIXED v2:
  //   1. Publish 'restarted' dengan retain:TRUE ke dashboard
  //      → Dashboard pasti terima meski MQTT sedang reconnect
  //      → Dashboard akan finalize row lama, set awaitingNewSetup=true
  //      → Dashboard clear retained message setelah terima
  //   2. Kirim perintah RESTART ke ESP32
  //   3. Refresh halaman setelah 4 detik
  //
  //   INSERT row baru terjadi saat btnSaveSetup ditekan
  // ─────────────────────────────────────────────────────────
  document.getElementById('btnRestartESP')?.addEventListener('click', async () => {
    if (!confirm(
      '⚠️ Restart ESP32 Mesin 1?\n\n' +
      '→ Koneksi MQTT putus sementara\n' +
      '→ Counter di ESP32 reset\n' +
      '→ Setelah restart: isi shift & produk lalu tekan Simpan Setup\n' +
      '→ Sistem akan reconnect otomatis'
    )) return;

    showToast('🔄 Mengirim sinyal restart...', '#fb923c');

    // LANGKAH 1: Beritahu dashboard — RETAIN:TRUE agar pasti diterima
    // Dashboard akan clear retained message setelah menerima
    mqttClient.publish('oee/machine1/restarted', '1', { retain: true });
    console.log('[Mesin1] Signal restarted dikirim ke dashboard (retain:true)');

    // LANGKAH 2: Kirim perintah restart ke ESP32
    mqttClient.publish('oee/machine1/restart', 'RESTART', { retain: false });
    showToast('🔄 Perintah RESTART ESP32 dikirim...', '#f87171');

    // LANGKAH 3: Refresh halaman setelah 4 detik
    setTimeout(() => { window.location.reload(); }, 4000);
  });

  // ─────────────────────────────────────────────────────────
  // btnReset — reset data & tampilan saja
  //   → Target tetap tidak berubah
  //   → Tidak memicu INSERT DB apapun
  // ─────────────────────────────────────────────────────────
  document.getElementById('btnReset')?.addEventListener('click', () => {
    if (!confirm('⚠️ Reset data produksi Mesin 1?\n\nTarget produksi akan tetap tidak berubah.')) return;
    doReset();
    if (totalTargetEl) totalTargetEl.innerText = String(totalTarget);
    mqttClient.publish('oee/machine1/reset', 'RESET', { retain: false });
    updateDisplay();
  });

  // ─────────────────────────────────────────────────────────
  // btnSaveSetup — simpan target, shift, produk
  //   → Publish setup-info ke dashboard
  //   → Jika dashboard dalam mode awaitingNewSetup (setelah restart),
  //     dashboard akan INSERT row baru dengan data shift & produk yang lengkap
  // ─────────────────────────────────────────────────────────
  document.getElementById('btnSaveSetup')?.addEventListener('click', () => {
    const target  = parseInt(targetInput?.value) || 0;
    const date    = document.getElementById('productionDate')?.value || '';
    const shift   = document.getElementById('shift')?.value || '1';
    const product = document.getElementById('productName')?.value || '';
    if (!target) { alert('⚠️ Masukkan Target Produksi terlebih dahulu!'); return; }
    totalTarget = target;
    mqttClient.publish('oee/machine1/target', String(target), { retain: true });

    // Publish setup-info — dashboard akan INSERT baru jika awaitingNewSetup=true
    mqttClient.publish('oee/machine1/setup-info', JSON.stringify({
      shift:   parseInt(shift),
      product: product || '-',
      date:    date,
    }), { retain: true });

    alert(
      `✅ Setup tersimpan!\n` +
      `Target : ${target} pcs\n` +
      `Est.   : ${formatEstimasi(target * MS_PER_PCS)}\n` +
      `Produk : ${product || '-'}\n` +
      `Shift  : ${shift}`
    );
    updateDisplay();
  });

  // ════════════════════════════════════════════════════════
  // UPDATE DISPLAY
  // ════════════════════════════════════════════════════════
  function updateDisplay() {
    if (inputOneEl)    inputOneEl.innerText    = inputOne;
    if (inputZeroEl)   inputZeroEl.innerText   = inputZero;
    if (totalTargetEl) totalTargetEl.innerText = totalTarget;
    if (setupTimeEl)   setupTimeEl.innerText   = formatTime(setupTime);
    if (downtimeEl)    downtimeEl.innerText    = formatTime(downtimeAcc);
    if (watchStart === null) {
      if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc + minorBreakdownWatch);
    }
    if (runtimeEl) runtimeEl.innerText = formatTime(runtime);
    const estEl = document.getElementById('estimasiWaktu');
    if (estEl) estEl.innerText = totalTarget > 0 ? formatEstimasi(totalTarget * MS_PER_PCS) : '—';
    saveState();
  }

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════
  loadState();
  renderLog();
  updateDisplay();
  updateRelayBadge(sensorEnabled);

  setInterval(saveState, 10000);

  console.log('✅ controle.js loaded (FIXED v2)');
  console.log('   btnRestartESP → publish restarted retain:true → ESP32 restart → refresh');
  console.log('   btnReset      → reset data saja, target tetap, TIDAK INSERT DB');
  console.log('   btnSaveSetup  → publish setup-info → dashboard INSERT baru jika awaitingNewSetup');
});