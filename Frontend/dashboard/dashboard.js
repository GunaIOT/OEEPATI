const MS_PER_PCS = 2222;

const LOST_LIMIT = 3 * 60 * 1000; // 3 menit

function makeState() {
  return {
    inputOne:    0,
    inputZero:   0,
    totalTarget: 0,
    setupTime:   0,
    lostTimeAcc: 0,   // lost time final (sesi < 3 mnt yang sudah selesai)
    downtimeAcc: 0,   // downtime final (sudah di-submit)
    runtime:     0,
    online:      false,
    // ── stopwatch ──
    lostWatch:   0,    // ms terakumulasi di stopwatch ini
    watchStart:  null, // timestamp resume terakhir (null = pause)
    inDowntime:  false,// sudah >= 3 mnt?
    _liveTimer:  null,
  };
}
const state1 = makeState();
const state2 = makeState();

// Total reject dari halaman Reject Packaging (dikirim via MQTT)
let totalRejectFromPackaging = 0;

// ── Helper: ms → HH:MM:SS ──────────────────────────────────
function formatTime(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return [h, m, sc].map(v => String(v).padStart(2, '0')).join(':');
}

// ── Helper: ms → estimasi "Xj Ym Zd" ──────────────────────
function formatEstimasi(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  if (h > 0) return `${h}j ${m}m ${sc}d`;
  if (m > 0) return `${m}m ${sc}d`;
  return `${sc}d`;
}

// ── Helper: get element ────────────────────────────────────
const el = id => document.getElementById(id);

// ── Stopwatch tracker per mesin ────────────────────────────
// Konsep: stopwatch pause/resume
//   count=0 → resume (watchStart = now)
//   count=1 → pause  (lostWatch += elapsed, watchStart = null)
//
// Display live dihandle oleh _liveTimer tiap 500ms
// updateDisplay1/2 hanya menulis saat stopwatch pause

function getWatchTotal(st) {
  if (st.watchStart === null) return st.lostWatch;
  return st.lostWatch + (Date.now() - st.watchStart);
}

function startZeroTrack(st, num) {
  if (st.watchStart !== null) return; // sudah running, abaikan

  st.watchStart = Date.now();

  clearInterval(st._liveTimer);
  st._liveTimer = setInterval(() => {
    const total  = getWatchTotal(st);
    const lostEl = el('lostTime' + num);
    const dtEl   = el('downtime' + num);

    if (!st.inDowntime) {
      if (total < LOST_LIMIT) {
        // Fase 1: tampil lostTimeAcc (sesi sebelumnya) + sesi ini
        if (lostEl) lostEl.innerText = formatTime(st.lostTimeAcc + total);
      } else {
        // Masuk downtime — bekukan lostTime di lostTimeAcc
        st.inDowntime = true;
        if (lostEl) lostEl.innerText = formatTime(st.lostTimeAcc);
      }
    }

    // Downtime selalu update saat inDowntime (termasuk lostWatch yang sedang jalan)
    if (st.inDowntime) {
      if (dtEl) dtEl.innerText = formatTime(st.downtimeAcc + total);
    }

    // Juga update downtime display meski belum inDowntime (agar tidak tertinggal)
    if (!st.inDowntime && dtEl) dtEl.innerText = formatTime(st.downtimeAcc);
  }, 500);
}

function stopZeroTrack(st, num) {
  if (st.watchStart === null) return; // sudah pause

  st.lostWatch += Date.now() - st.watchStart;
  st.watchStart  = null;

  clearInterval(st._liveTimer);
  st._liveTimer = null;

  // Commit ke bucket yang tepat
  if (!st.inDowntime) {
    // Sesi < 3 menit → masuk Lost Time, reset lostWatch
    st.lostTimeAcc += st.lostWatch;
    st.lostWatch    = 0;
    console.log(`[M${num}] LostTime commit: ${(st.lostTimeAcc/1000).toFixed(1)}s total`);
  } else {
    // >= 3 menit — downtime di-commit saat user submit manual
    // lostWatch tetap agar bisa di-commit nanti
    console.log(`[M${num}] Downtime session paused: lostWatch=${(st.lostWatch/1000).toFixed(1)}s`);
  }
}

// ── Update estimasi waktu dari target ──────────────────────
function updateEstimasi(machineNum, targetPcs) {
  const e = el('estimasi' + machineNum);
  if (!e) return;
  e.innerText = targetPcs > 0 ? formatEstimasi(targetPcs * MS_PER_PCS) : '—';
}

// ── Update tampilan Mesin 1 ────────────────────────────────
function updateDisplay1() {
  const totalPieces = state1.inputOne + state1.inputZero;

  if (el('pieces1'))           el('pieces1').innerText           = totalPieces;
  if (el('inputOne1'))         el('inputOne1').innerText         = state1.inputOne;
  if (el('inputZero1'))        el('inputZero1').innerText        = state1.inputZero;
  if (el('target1'))           el('target1').innerText           = state1.totalTarget;
  if (el('setupTime1'))        el('setupTime1').innerText        = formatTime(state1.setupTime);
  // Downtime selalu update
  if (el('downtime1'))  el('downtime1').innerText  = formatTime(state1.downtimeAcc);
  // lostTime: hanya update saat stopwatch pause
  if (state1.watchStart === null) {
    // lostWatch = 0 setelah commit, jadi ini = lostTimeAcc
    const lostTotal1 = state1.lostTimeAcc + state1.lostWatch;
    if (el('lostTime1'))    el('lostTime1').innerText    = formatTime(lostTotal1);
    if (el('lostTimeSec1')) el('lostTimeSec1').innerText = (lostTotal1 / 1000).toFixed(3) + ' s';
  }
  if (el('runtime1'))     el('runtime1').innerText     = formatTime(state1.runtime);

  updateEstimasi(1, state1.totalTarget);
  updateSummary();
  updateOEE();
  updateTimestamp();
}

function updateDisplay2() {
  const totalPieces = state2.inputOne + state2.inputZero;

  if (el('pieces2'))           el('pieces2').innerText           = totalPieces;
  if (el('inputOne2'))         el('inputOne2').innerText         = state2.inputOne;
  if (el('inputZero2'))        el('inputZero2').innerText        = state2.inputZero;
  if (el('target2'))           el('target2').innerText           = state2.totalTarget;
  if (el('setupTime2'))        el('setupTime2').innerText        = formatTime(state2.setupTime);
  if (el('downtime2'))  el('downtime2').innerText  = formatTime(state2.downtimeAcc);
  if (state2.watchStart === null) {
    const lostTotal2 = state2.lostTimeAcc + state2.lostWatch;
    if (el('lostTime2'))    el('lostTime2').innerText    = formatTime(lostTotal2);
    if (el('lostTimeSec2')) el('lostTimeSec2').innerText = (lostTotal2 / 1000).toFixed(3) + ' s';
  }
  if (el('runtime2'))     el('runtime2').innerText     = formatTime(state2.runtime);

  updateEstimasi(2, state2.totalTarget);
  updateSummary();
  updateOEE();
  updateTimestamp();
}

function updateSummary() {
  const total1 = state1.inputOne + state1.inputZero;
  const total2 = state2.inputOne + state2.inputZero;
  const totalProd   = total1 + total2;
  const totalTarget = state1.totalTarget + state2.totalTarget;
  const pct    = totalTarget > 0 ? Math.min(Math.round((totalProd / totalTarget) * 100), 100) : 0;
  const active = (state1.online ? 1 : 0) + (state2.online ? 1 : 0);
  const totalGoodRaw = state1.inputOne + state2.inputOne;
  const totalGood = Math.max(0, totalGoodRaw - totalRejectFromPackaging); // Net: Good(1) - Reject
  const totalZero = state1.inputZero + state2.inputZero;

  if (el('total-production'))  el('total-production').innerText  = totalProd;
  if (el('total-target'))      el('total-target').innerText      = totalTarget;
  if (el('total-percent'))     el('total-percent').innerText     = pct + '%';
  if (el('active-machines'))   el('active-machines').innerText   = active;
  if (el('total-input-good'))  el('total-input-good').innerText  = totalGood;
  if (el('total-input-zero'))  el('total-input-zero').innerText  = totalZero;

  // Total waktu (gabungan kedua mesin)
  const totalLost     = (state1.lostTimeAcc + state1.lostWatch) + (state2.lostTimeAcc + state2.lostWatch);
  const totalDowntime = state1.downtimeAcc + state2.downtimeAcc;
  if (el('total-lost-time'))  el('total-lost-time').innerText  = formatTime(totalLost);
  if (el('total-downtime'))   el('total-downtime').innerText   = formatTime(totalDowntime);
}

// ── Timestamp update terakhir ──────────────────────────────
function updateTimestamp() {
  if (el('update-time'))
    el('update-time').innerText = new Date().toLocaleTimeString('id-ID');
}

// ── Status badge mesin ─────────────────────────────────────
function setMachineStatus(num, online) {
  const s = el('status' + num);
  const m = el('machine' + num);
  if (!s) return;
  if (online) {
    s.innerText   = 'ONLINE';
    s.className   = 'font-mono text-[9px] tracking-[0.2em] uppercase px-3.5 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25';
    m?.classList.remove('border-white/[0.07]', 'border-red-500/20');
    m?.classList.add('border-emerald-500/20');
  } else {
    s.innerText   = 'OFFLINE';
    s.className   = 'font-mono text-[9px] tracking-[0.2em] uppercase px-3.5 py-1.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/25';
    m?.classList.remove('border-emerald-500/20', 'border-white/[0.07]');
    m?.classList.add('border-red-500/20');
  }
}

// ── Notifikasi reset ───────────────────────────────────────
function showResetNotification(name) {
  let n = document.getElementById('reset-notif');
  if (n) n.remove();
  n = document.createElement('div');
  n.id = 'reset-notif';
  n.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;background:#13171f;border:1px solid rgba(197,168,96,0.3);border-radius:12px;padding:14px 20px;display:flex;align-items:center;gap:12px;animation:fadeUp 0.4s ease';
  n.innerHTML = `<span style="font-size:18px">🔄</span><div>
    <div style="font-family:DM Mono,monospace;font-size:10px;letter-spacing:0.12em;color:#c5a860;text-transform:uppercase">System Reset</div>
    <div style="font-size:12px;color:#7a7870;margin-top:2px">Data ${name} telah direset</div>
  </div>`;
  document.body.appendChild(n);
  setTimeout(() => n?.remove(), 5000);
}

// ══ MQTT ══════════════════════════════════════════════════
const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected');
  if (el('mqtt-status')) {
    el('mqtt-status').innerText   = 'Connected';
    el('mqtt-status').style.color = '#4ade80';
  }
  ['machine1','machine2'].forEach(m => {
    ['count','setup','lost','runtime','target','reset','downtime','downtime-start'].forEach(t => {
      mqttClient.subscribe(`oee/${m}/${t}`);
    });
  });
  // Subscribe ke data reject dari halaman reject packaging
  mqttClient.subscribe('oee/reject/data');
  console.log('📡 Subscribed semua topic');
});

mqttClient.on('error',     () => { if (el('mqtt-status')) { el('mqtt-status').innerText = 'Error';        el('mqtt-status').style.color = '#f87171'; }});
mqttClient.on('reconnect', () => { if (el('mqtt-status')) { el('mqtt-status').innerText = 'Reconnecting'; el('mqtt-status').style.color = '#fb923c'; }});
mqttClient.on('offline',   () => {
  if (el('mqtt-status')) { el('mqtt-status').innerText = 'Offline'; el('mqtt-status').style.color = '#f87171'; }
  state1.online = state2.online = false;
  setMachineStatus(1, false); setMachineStatus(2, false);
  updateSummary();
});

// ── MQTT message handler ───────────────────────────────────
mqttClient.on('message', (topic, message) => {
  const payload = message.toString().trim();
  console.log(`📨 [${topic}] → ${payload}`);

  // ══ MESIN 1 ══════════════════════════════════════════════
  if (topic === 'oee/machine1/count') {
    state1.online = true;
    setMachineStatus(1, true);
    lastMsg1 = Date.now();

    if (payload === '1') {
      state1.inputOne++;
      stopZeroTrack(state1, 1);
    } else {
      state1.inputZero++;
      startZeroTrack(state1, 1);
    }
    updateDisplay1();
  }

  if (topic === 'oee/machine1/setup') {
    state1.setupTime = parseInt(payload) || 0;
    updateDisplay1();
  }

  if (topic === 'oee/machine1/lost') {
    console.log(`[M1] Lost streak from ESP32: ${payload}ms`);
  }

  if (topic === 'oee/machine1/runtime') {
    state1.runtime = parseInt(payload) || 0;
    updateDisplay1();
  }

  if (topic === 'oee/machine1/target') {
    state1.totalTarget = parseInt(payload) || 0;
    updateDisplay1();
  }

  // Downtime dimulai (popup muncul di controle.js) — set inDowntime agar liveTimer naik
  if (topic === 'oee/machine1/downtime-start') {
    state1.inDowntime = true;
    console.log('[M1] downtime-start received — liveTimer akan naik');
  }

  if (topic === 'oee/machine1/downtime') {
    try {
      const ev = JSON.parse(payload);
      state1.downtimeAcc += ev.durasi_ms || 0;
      // Reset stopwatch sesi ini — lostWatch kembali ke 0, siap untuk sesi berikutnya
      state1.lostWatch  = 0;
      state1.inDowntime = false;
      // liveTimer tetap jalan — fase 1 lagi dari 0
      console.log(`[M1] Downtime submit: ${ev.alasan} (${((ev.durasi_ms||0)/1000).toFixed(0)}s) total=${(state1.downtimeAcc/1000).toFixed(0)}s`);
      // Update downtime display langsung dengan nilai final
      if (el('downtime1')) el('downtime1').innerText = formatTime(state1.downtimeAcc);
      updateDisplay1();
    } catch(e) { console.warn('⚠️ downtime parse error M1:', e); }
  }

  if (topic === 'oee/machine1/reset') {
    console.log('🔄 RESET Mesin 1');
    clearInterval(state1._liveTimer);
    Object.assign(state1, makeState());
    totalRejectFromPackaging = 0;
    // Broadcast reset ke reject packaging — Good(1) di sana ikut kembali ke 0
    mqttClient.publish('oee/reject/total', '0', { retain: true });
    setMachineStatus(1, false);
    updateDisplay1();
    showResetNotification('Mesin 1');
  }

  // ══ MESIN 2 ══════════════════════════════════════════════
  if (topic === 'oee/machine2/count') {
    state2.online = true;
    setMachineStatus(2, true);
    lastMsg2 = Date.now();

    if (payload === '1') {
      state2.inputOne++;
      stopZeroTrack(state2, 2);
    } else {
      state2.inputZero++;
      startZeroTrack(state2, 2);
    }
    updateDisplay2();
  }

  if (topic === 'oee/machine2/setup') {
    state2.setupTime = parseInt(payload) || 0;
    updateDisplay2();
  }

  if (topic === 'oee/machine2/lost') {
    console.log(`[M2] Lost streak from ESP32: ${payload}ms`);
  }

  if (topic === 'oee/machine2/runtime') {
    state2.runtime = parseInt(payload) || 0;
    updateDisplay2();
  }

  if (topic === 'oee/machine2/target') {
    state2.totalTarget = parseInt(payload) || 0;
    updateDisplay2();
  }

  if (topic === 'oee/machine2/downtime-start') {
    state2.inDowntime = true;
    console.log('[M2] downtime-start received — liveTimer akan naik');
  }

  if (topic === 'oee/machine2/downtime') {
    try {
      const ev = JSON.parse(payload);
      state2.downtimeAcc += ev.durasi_ms || 0;
      state2.lostWatch  = 0;
      state2.inDowntime = false;
      console.log(`[M2] Downtime submit: ${ev.alasan} (${((ev.durasi_ms||0)/1000).toFixed(0)}s) total=${(state2.downtimeAcc/1000).toFixed(0)}s`);
      if (el('downtime2')) el('downtime2').innerText = formatTime(state2.downtimeAcc);
      updateDisplay2();
    } catch(e) { console.warn('⚠️ downtime parse error M2:', e); }
  }

  if (topic === 'oee/machine2/reset') {
    console.log('🔄 RESET Mesin 2');
    clearInterval(state2._liveTimer);
    Object.assign(state2, makeState());
    totalRejectFromPackaging = 0;
    // Broadcast reset ke reject packaging
    mqttClient.publish('oee/reject/total', '0', { retain: true });
    setMachineStatus(2, false);
    updateDisplay2();
    showResetNotification('Mesin 2');
  }

  // ══ SINKRON TOTAL REJECT (retained, saat halaman baru dibuka) ══
  if (topic === 'oee/reject/total') {
    const val = parseInt(payload) || 0;
    if (val !== totalRejectFromPackaging) {
      totalRejectFromPackaging = val;
      updateSummary();
      updateOEE();
    }
  }

  // ══ DATA REJECT DARI HALAMAN REJECT PACKAGING ════════════
  if (topic === 'oee/reject/data') {
    try {
      const rec = JSON.parse(payload);
      // Ambil totalReject terbaru dari record submit
      if (typeof rec.totalReject === 'number') {
        totalRejectFromPackaging += rec.totalReject;  // AKUMULASI, bukan replace
        console.log(`📦 Reject +${rec.totalReject}, total: ${totalRejectFromPackaging}`);
        // Broadcast total terbaru ke semua halaman (termasuk reject packaging)
        mqttClient.publish('oee/reject/total', String(totalRejectFromPackaging), { retain: true });
        updateSummary();
        updateOEE();
        updateTimestamp();
      }
    } catch(e) {
      console.warn('⚠️ Gagal parse reject data:', e);
    }
  }
});

// ── Deteksi offline timeout 30 detik ──────────────────────
let lastMsg1 = 0, lastMsg2 = 0;

setInterval(() => {
  const now = Date.now();
  if (state1.online && now - lastMsg1 > 30000) {
    state1.online = false; setMachineStatus(1, false); updateSummary();
    console.log('⚠️ Machine 1 offline (timeout)');
  }
  if (state2.online && now - lastMsg2 > 30000) {
    state2.online = false; setMachineStatus(2, false); updateSummary();
    console.log('⚠️ Machine 2 offline (timeout)');
  }
}, 5000);

// ══ OEE GAUGE ═════════════════════════════════════════════
function drawGauge(canvasId, pct, color) {
  const canvas = el(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H - 10;
  const r  = Math.min(W * 0.42, H * 0.88);
  ctx.clearRect(0, 0, W, H);

  const SA = Math.PI, EA = 2 * Math.PI;

  // Track
  ctx.beginPath(); ctx.arc(cx, cy, r, SA, EA);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke();

  // Zones
  [{f:0,t:.45,c:'rgba(248,113,113,0.18)'},{f:.45,t:.65,c:'rgba(251,146,60,0.18)'},
   {f:.65,t:.85,c:'rgba(250,204,21,0.18)'},{f:.85,t:1,c:'rgba(74,222,128,0.18)'}].forEach(z=>{
    ctx.beginPath(); ctx.arc(cx, cy, r, SA+z.f*Math.PI, SA+z.t*Math.PI);
    ctx.strokeStyle=z.c; ctx.lineWidth=16; ctx.lineCap='butt'; ctx.stroke();
  });

  // Value arc
  const c = Math.min(Math.max(pct,0),100);
  if (c > 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r, SA, SA+(c/100)*Math.PI);
    ctx.strokeStyle=color; ctx.lineWidth=16; ctx.lineCap='round';
    ctx.shadowColor=color; ctx.shadowBlur=18; ctx.stroke(); ctx.shadowBlur=0;
  }

  // Ticks
  [0,25,50,75,100].forEach(t=>{
    const a = SA+(t/100)*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx+(r-22)*Math.cos(a), cy+(r-22)*Math.sin(a));
    ctx.lineTo(cx+(r-8)*Math.cos(a), cy+(r-8)*Math.sin(a));
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1.5; ctx.lineCap='round'; ctx.stroke();
  });

  // Needle
  const na = SA+(c/100)*Math.PI;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+(r-26)*Math.cos(na), cy+(r-26)*Math.sin(na));
  ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.lineCap='round';
  ctx.shadowColor='#fff'; ctx.shadowBlur=8; ctx.stroke(); ctx.shadowBlur=0;

  // Center dot
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI*2);
  ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=12; ctx.fill(); ctx.shadowBlur=0;

  // Labels
  ctx.font='400 9px "DM Mono",monospace'; ctx.fillStyle='rgba(255,255,255,0.28)';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  [['0',SA],['50',SA+.5*Math.PI],['100',EA]].forEach(([l,a])=>{
    ctx.fillText(l, cx+(r+18)*Math.cos(a), cy+(r+18)*Math.sin(a));
  });
}

function oeeLabel(p) {
  if (p>=85) return 'World Class ✦';
  if (p>=65) return 'Good';
  if (p>=45) return 'Average';
  return 'Below Average';
}
function gaugeColor(p) {
  if (p>=85) return '#4ade80';
  if (p>=65) return '#facc15';
  if (p>=45) return '#fb923c';
  return '#f87171';
}

function updateOEE() {
  // Good(1) dikurangi total reject dari packaging
  const rawGood     = state1.inputOne + state2.inputOne;
  const netGood     = Math.max(0, rawGood - totalRejectFromPackaging);

  const totalTarget = (state1.totalTarget || 0) + (state2.totalTarget || 0);
  const totalPieces = (state1.inputOne + state1.inputZero) + (state2.inputOne + state2.inputZero);

  // Runtime gabungan (ambil yang terbesar / rata-rata kedua mesin dalam ms)
  // Gunakan total runtime kedua mesin dibagi 2 jika keduanya aktif, atau yang ada nilai
  const runtimeMs1 = state1.runtime || 0;
  const runtimeMs2 = state2.runtime || 0;
  // Gunakan max runtime sebagai waktu actual (shift berjalan bersamaan)
  const actualRuntimeMs = Math.max(runtimeMs1, runtimeMs2);

  // ── Availability Rate ──────────────────────────────────
  const estWaktu = totalTarget * MS_PER_PCS;
  const downtime = (state1.lostTimeAcc + state1.lostWatch + state1.downtimeAcc) + (state2.lostTimeAcc + state2.lostWatch + state2.downtimeAcc);
  const ar = estWaktu > 0 ? Math.max(((estWaktu - downtime) / estWaktu) * 100, 0) : 0;

  // ── Performance Rate (RUMUS BARU) ──────────────────────
  // PR = (netGood × 2.222 detik ÷ 60) ÷ (Runtime_detik ÷ 60) × 100
  // → PR = (netGood × 2.222) / Runtime_detik × 100
  // Runtime dikonversi dari ms ke detik
  const runtimeSec = actualRuntimeMs / 1000;
  const pr = runtimeSec > 0
    ? Math.min(((netGood * (MS_PER_PCS / 1000)) / runtimeSec) * 100, 100)
    : 0;

  // ── Quality Rate ───────────────────────────────────────
  // QR = netGood / totalPieces × 100
  const qr = totalPieces > 0 ? Math.min((netGood / totalPieces) * 100, 100) : 0;

  const oee  = (ar / 100) * (pr / 100) * (qr / 100) * 100;
  const arR  = Math.round(ar);
  const prR  = Math.round(pr);
  const qrR  = Math.round(qr);
  const oeeR = Math.round(oee);

  drawGauge('gauge-ar', arR, gaugeColor(arR));
  drawGauge('gauge-pr', prR, '#60a5fa');
  drawGauge('gauge-qr', qrR, '#a78bfa');

  if (el('ar-value')) { el('ar-value').innerText = arR + '%'; el('ar-value').style.color = gaugeColor(arR); }
  if (el('pr-value'))   el('pr-value').innerText = prR + '%';
  if (el('qr-value'))   el('qr-value').innerText = qrR + '%';
  if (el('ar-label'))   el('ar-label').innerText = oeeLabel(arR);
  if (el('pr-label'))   el('pr-label').innerText = oeeLabel(prR);
  if (el('qr-label'))   el('qr-label').innerText = oeeLabel(qrR);
  if (el('oee-value'))  el('oee-value').innerText = oeeR + '%';
  if (el('oee-bar'))    el('oee-bar').style.width  = Math.min(oeeR, 100) + '%';

  // Log untuk debug
  console.log(`[OEE] netGood=${netGood} (raw=${rawGood} - reject=${totalRejectFromPackaging})`);
  console.log(`[OEE] AR=${arR}% | PR=${prR}% (runtimeSec=${runtimeSec.toFixed(1)}) | QR=${qrR}% | OEE=${oeeR}%`);
}

// ── Download Excel ─────────────────────────────────────────
function downloadExcel() {
  const date  = document.getElementById('download-date')?.value;
  const shift = document.getElementById('download-shift')?.value || '1';
  if (!date) { alert('Pilih tanggal terlebih dahulu!'); return; }

  const total1 = state1.inputOne + state1.inputZero;
  const total2 = state2.inputOne + state2.inputZero;
  const rawGood = state1.inputOne + state2.inputOne;
  const netGood = Math.max(0, rawGood - totalRejectFromPackaging);

  const rows = [
    ['LAPORAN PRODUKSI MESIN PACKING'],
    ['Tanggal', date],
    ['Shift', `Shift ${shift}`],
    ['Waktu per pcs', `${MS_PER_PCS/1000} detik`],
    ['Total Reject Packaging', totalRejectFromPackaging],
    [],
    ['Mesin','Input Good (1)','Input No Obj (0)','Total Pieces','Target','Est. Waktu','Progress %','Setup Time','Lost Time','Runtime','Operator'],
    ['Mesin Packing #1', state1.inputOne, state1.inputZero, total1, state1.totalTarget,
      formatEstimasi(state1.totalTarget * MS_PER_PCS),
      state1.totalTarget > 0 ? Math.round((total1 / state1.totalTarget) * 100) + '%' : '0%',
      formatTime(state1.setupTime), formatTime(state1.lostTimeAcc + state1.lostWatch), formatTime(state1.runtime), 'Budi Santoso'],
    ['Mesin Packing #2', state2.inputOne, state2.inputZero, total2, state2.totalTarget,
      formatEstimasi(state2.totalTarget * MS_PER_PCS),
      state2.totalTarget > 0 ? Math.round((total2 / state2.totalTarget) * 100) + '%' : '0%',
      formatTime(state2.setupTime), formatTime(state2.lostTimeAcc + state2.lostWatch), formatTime(state2.runtime), 'Siti Nurhaliza'],
    [],
    ['TOTAL', '', '', total1 + total2, state1.totalTarget + state2.totalTarget, '', '', '', '', '', ''],
    [],
    ['KUALITAS'],
    ['Raw Good (1)', rawGood],
    ['Total Reject Packaging', totalRejectFromPackaging],
    ['Net Good (setelah reject)', netGood],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan Produksi');
  XLSX.writeFile(wb, `Laporan_Produksi_${date}_Shift${shift}.xlsx`);
}

// ── Default tanggal ────────────────────────────────────────
const dlDate = el('download-date');
if (dlDate) {
  const n = new Date();
  dlDate.value = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

// ── Init ───────────────────────────────────────────────────
updateDisplay1();
updateDisplay2();
updateOEE();

console.log('✅ dashboard.js loaded');
console.log('   PR = (netGood × 2.222s) / (Runtime_detik) × 100');
console.log('   netGood = Good(1) - Total Reject Packaging');