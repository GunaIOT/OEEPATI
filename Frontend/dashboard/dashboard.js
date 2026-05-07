const MS_PER_PCS         = 2069;
const MS_PER_PCS_PARALEL = 1034;
const POPUP_LIMIT        = 3  * 60 * 1000;
const BREAKDOWN_LIMIT    = 10 * 60 * 1000;
const RESET_SAVE_DELAY   = 5000;

let setupInfo1 = { shift: 1, product: '-', date: new Date().toISOString().split('T')[0] };
let setupInfo2 = { shift: 1, product: '-', date: new Date().toISOString().split('T')[0] };

const SHIFT_LABELS = {
  1: 'Shift 1 · 06:00–14:00',
  2: 'Shift 2 · 14:00–22:00',
  3: 'Shift 3 · 22:00–06:00',
};

function renderSetupInfo() {
  const shift1 = setupInfo1.shift   || 1;
  const shift2 = setupInfo2.shift   || 1;
  const prod1  = setupInfo1.product || '-';
  const prod2  = setupInfo2.product || '-';
  const date1  = setupInfo1.date    || '-';

  const badge1 = el('shift-badge1');
  const badge2 = el('shift-badge2');
  if (badge1) badge1.innerText = SHIFT_LABELS[shift1] || `Shift ${shift1}`;
  if (badge2) badge2.innerText = SHIFT_LABELS[shift2] || `Shift ${shift2}`;

  const pb1 = el('product-badge1');
  const pb2 = el('product-badge2');
  if (pb1) { pb1.innerText = prod1; pb1.style.display = (prod1 && prod1 !== '-') ? 'inline-block' : 'none'; }
  if (pb2) { pb2.innerText = prod2; pb2.style.display = (prod2 && prod2 !== '-') ? 'inline-block' : 'none'; }

  const elShift = el('dash-shift');
  const elDate  = el('dash-date');
  const elProd  = el('dash-product');
  if (elShift) elShift.innerText = SHIFT_LABELS[shift1] || `Shift ${shift1}`;
  if (elDate)  elDate.innerText  = date1;
  if (elProd)  elProd.innerText  = prod1;
}

// ══════════════════════════════════════════════════════════════
//  STATE — hanya dipakai sebagai buffer MQTT real-time
//  Nilai awal (saat page load) di-SYNC dari server, bukan localStorage
// ══════════════════════════════════════════════════════════════
function makeState() {
  return {
    inputOne: 0, inputZero: 0, totalTarget: 0, setupTime: 0,
    minorBreakdownAcc: 0, downtimeAcc: 0, runtime: 0, online: false,
    minorBreakdownWatch: 0, watchStart: null, inDowntime: false, _liveTimer: null,
  };
}
const state1 = makeState();
const state2 = makeState();

let sensor1Enabled           = false;
let sensor2Enabled           = false;
let totalRejectFromPackaging = 0;

let _resetInProgress = false;
const resetFlags = { m1: false, m2: false };
function bothReset() { return resetFlags.m1 && resetFlags.m2; }

// localStorage hanya untuk session ID, BUKAN untuk state produksi
const STORAGE_KEY_DASH = 'oee_dashboard_state';

// Simpan hanya sensor enabled state (bukan counter) — counter dari server
function saveDashState() {
  const snap = {
    state1: {
      // Counter TIDAK disimpan di localStorage lagi
      // hanya timing yang susah direcovery dari server
      minorBreakdownWatch: state1.minorBreakdownWatch + (state1.watchStart !== null ? Date.now() - state1.watchStart : 0),
      sensorEnabled:       sensor1Enabled,
      online:              state1.online,
    },
    state2: {
      minorBreakdownWatch: state2.minorBreakdownWatch + (state2.watchStart !== null ? Date.now() - state2.watchStart : 0),
      sensorEnabled:       sensor2Enabled,
      online:              state2.online,
    },
    setupInfo1,
    setupInfo2,
    totalRejectFromPackaging,
    savedAt: Date.now(),
  };
  try { localStorage.setItem(STORAGE_KEY_DASH, JSON.stringify(snap)); } catch(e) {}
}

// Load hanya sensor state dari localStorage (bukan counter)
function loadLocalSensorState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DASH);
    if (!raw) return;
    const snap = JSON.parse(raw);
    if (snap.state1) {
      sensor1Enabled = snap.state1.sensorEnabled || false;
      state1.minorBreakdownWatch = snap.state1.minorBreakdownWatch || 0;
    }
    if (snap.state2) {
      sensor2Enabled = snap.state2.sensorEnabled || false;
      state2.minorBreakdownWatch = snap.state2.minorBreakdownWatch || 0;
    }
    if (snap.setupInfo1) setupInfo1 = snap.setupInfo1;
    if (snap.setupInfo2) setupInfo2 = snap.setupInfo2;
    totalRejectFromPackaging = snap.totalRejectFromPackaging || 0;
  } catch(e) {}
}

function clearDashStateAll() {
  try {
    localStorage.removeItem(STORAGE_KEY_DASH);
    localStorage.removeItem('oee_mesin1_state');
    localStorage.removeItem('oee_mesin2_state');
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════
//  SYNC STATE DARI SERVER — dipanggil saat page load
//  Ambil data session aktif dari DB, isi ke state1/state2
//  Sehingga laptop A, B, C semua mulai dari angka yang sama
// ══════════════════════════════════════════════════════════════
async function syncStateFromServer() {
  try {
    const tgl   = setupInfo1.date  || new Date().toISOString().split('T')[0];
    const shift = setupInfo1.shift || 1;

    showSyncNotif('Sinkronisasi data dari server...');

    // 1. Cek session produksi aktif
    const sessionRes  = await fetch(`${API_BASE}/session/active?tgl=${tgl}&shift=${shift}`);
    const sessionData = await sessionRes.json();

    if (sessionData.ok && sessionData.session_id) {
      dbSessionId = sessionData.session_id;
      localStorage.setItem(DB_SESSION_KEY, String(dbSessionId));

      // 2. Ambil detail session untuk restore counter
      const detailRes  = await fetch(`${API_BASE}/session/${dbSessionId}`);
      const detailData = await detailRes.json();

      if (detailData.ok && detailData.data) {
        const d = detailData.data;

        // Restore data produksi dari server ke state
        // finish_goods = inputOne gabungan kedua mesin (dikurangi reject)
        // Estimasi pembagian 50/50 jika tidak ada data per mesin
        const finishGoods = (d.finish_goods || 0) + (d.total_reject || 0); // raw good sebelum reject
        state1.inputOne  = Math.round(finishGoods / 2);
        state2.inputOne  = finishGoods - state1.inputOne;

        // Target
        state1.totalTarget = d.target_m1 || Math.round((d.target || 0) / 2);
        state2.totalTarget = d.target_m2 || ((d.target || 0) - state1.totalTarget);

        // Times (dalam ms, server simpan dalam detik)
        state1.setupTime    = Math.round((d.setup_time_ms || 0) / 2);
        state2.setupTime    = Math.round((d.setup_time_ms || 0) / 2);
        state1.downtimeAcc  = Math.round((d.downtime_ms || 0) / 2);
        state2.downtimeAcc  = Math.round((d.downtime_ms || 0) / 2);
        state1.minorBreakdownAcc = Math.round((d.minor_breakdown_ms || 0) / 2);
        state2.minorBreakdownAcc = Math.round((d.minor_breakdown_ms || 0) / 2);

        totalRejectFromPackaging = d.total_reject || 0;

        console.log(`[Dashboard SYNC] ✅ State di-restore dari server — session id=${dbSessionId}`, {
          inputOne1: state1.inputOne,
          inputOne2: state2.inputOne,
          target1: state1.totalTarget,
          target2: state2.totalTarget,
          reject: totalRejectFromPackaging,
        });

        startDbSaveInterval();
      }
    } else {
      console.log('[Dashboard SYNC] Tidak ada session aktif hari ini — mulai fresh');
    }

    // 3. Cek downtime session
    const dtRes  = await fetch(`${API_BASE}/downtime/active?tgl=${tgl}&shift=${shift}`);
    const dtData = await dtRes.json();
    if (dtData.ok && dtData.session_id) {
      dtSessionId = dtData.session_id;
      localStorage.setItem(DT_SESSION_KEY, String(dtSessionId));
      console.log(`[Dashboard SYNC] Downtime session id=${dtSessionId}`);
    }

    hideSyncNotif();
    updateDisplay1();
    updateDisplay2();
    updateOEE();

  } catch(err) {
    console.warn('[Dashboard SYNC] Gagal sync dari server:', err.message);
    hideSyncNotif();
    // Fallback: tetap jalan dengan state 0 (lebih baik dari data stale localStorage)
  }
}

function showSyncNotif(msg) {
  let n = document.getElementById('sync-notif');
  if (!n) {
    n = document.createElement('div');
    n.id = 'sync-notif';
    n.style.cssText =
      'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#13171f;border:1px solid rgba(96,165,250,0.4);border-radius:12px;' +
      'padding:12px 20px;display:flex;align-items:center;gap:10px;' +
      'box-shadow:0 0 24px rgba(96,165,250,0.12);';
    document.body.appendChild(n);
  }
  n.innerHTML = `
    <span style="font-size:16px">🔄</span>
    <div style="font-family:DM Mono,monospace;font-size:10px;letter-spacing:0.12em;color:#60a5fa;text-transform:uppercase">${msg}</div>
    <div style="width:14px;height:14px;border:2px solid rgba(96,165,250,0.3);border-top-color:#60a5fa;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>
    <style>#sync-notif @keyframes spin{to{transform:rotate(360deg)}}</style>`;
}

function hideSyncNotif() {
  document.getElementById('sync-notif')?.remove();
}

const el = id => document.getElementById(id);

function getWatchTotal(st) {
  if (st.watchStart === null) return st.minorBreakdownWatch;
  return st.minorBreakdownWatch + (Date.now() - st.watchStart);
}

function startZeroTrack(st, num) {
  if (st.watchStart !== null) return;
  st.watchStart = Date.now();
  clearInterval(st._liveTimer);
  st._liveTimer = setInterval(() => {
    const total  = Date.now() - st.watchStart;
    const lostEl = el('minorBreakdown' + num);
    const dtEl   = el('downtime' + num);
    if (!st.inDowntime) {
      if (lostEl) lostEl.innerText = formatTime(st.minorBreakdownAcc + total);
      if (dtEl)   dtEl.innerText   = formatTime(st.downtimeAcc);
    } else {
      if (lostEl) lostEl.innerText = formatTime(st.minorBreakdownAcc);
      if (dtEl)   dtEl.innerText   = formatTime(st.downtimeAcc + total);
    }
  }, 500);
}

function stopZeroTrack(st, num) {
  if (st.watchStart === null) return;
  clearInterval(st._liveTimer);
  st._liveTimer = null;
  st.watchStart = null;
  st.inDowntime = false;
}

function formatTime(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  return [h, m, sc].map(v => String(v).padStart(2, '0')).join(':');
}

function formatEstimasi(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  if (h > 0) return `${h}j ${m}m ${sc}d`;
  if (m > 0) return `${m}m ${sc}d`;
  return `${sc}d`;
}

function updateEstimasi(machineNum, targetPcs) {
  const e = el('estimasi' + machineNum);
  if (!e) return;
  e.innerText = targetPcs > 0 ? formatEstimasi(targetPcs * MS_PER_PCS) : '—';
}

function updateDisplay1() {
  const totalPieces = state1.inputOne + state1.inputZero;
  if (el('pieces1'))    el('pieces1').innerText    = totalPieces;
  if (el('inputOne1'))  el('inputOne1').innerText  = state1.inputOne;
  if (el('inputZero1')) el('inputZero1').innerText = state1.inputZero;
  if (el('target1'))    el('target1').innerText    = state1.totalTarget;
  if (el('setupTime1')) el('setupTime1').innerText = formatTime(state1.setupTime);
  if (el('downtime1'))  el('downtime1').innerText  = formatTime(state1.downtimeAcc);
  if (state1.watchStart === null) {
    const mb1 = state1.minorBreakdownAcc + state1.minorBreakdownWatch;
    if (el('minorBreakdown1'))    el('minorBreakdown1').innerText    = formatTime(mb1);
    if (el('minorBreakdownSec1')) el('minorBreakdownSec1').innerText = (mb1 / 1000).toFixed(3) + ' s';
  }
  if (el('runtime1')) el('runtime1').innerText = formatTime(state1.runtime);
  updateEstimasi(1, state1.totalTarget);
  updateSummary();
  updateOEE();
  updateTimestamp();
  saveDashState();
}

function updateDisplay2() {
  const totalPieces = state2.inputOne + state2.inputZero;
  if (el('pieces2'))    el('pieces2').innerText    = totalPieces;
  if (el('inputOne2'))  el('inputOne2').innerText  = state2.inputOne;
  if (el('inputZero2')) el('inputZero2').innerText = state2.inputZero;
  if (el('target2'))    el('target2').innerText    = state2.totalTarget;
  if (el('setupTime2')) el('setupTime2').innerText = formatTime(state2.setupTime);
  if (el('downtime2'))  el('downtime2').innerText  = formatTime(state2.downtimeAcc);
  if (state2.watchStart === null) {
    const mb2 = state2.minorBreakdownAcc + state2.minorBreakdownWatch;
    if (el('minorBreakdown2'))    el('minorBreakdown2').innerText    = formatTime(mb2);
    if (el('minorBreakdownSec2')) el('minorBreakdownSec2').innerText = (mb2 / 1000).toFixed(3) + ' s';
  }
  if (el('runtime2')) el('runtime2').innerText = formatTime(state2.runtime);
  updateEstimasi(2, state2.totalTarget);
  updateSummary();
  updateOEE();
  updateTimestamp();
  saveDashState();
}

function updateSummary() {
  const total1      = state1.inputOne + state1.inputZero;
  const total2      = state2.inputOne + state2.inputZero;
  const totalProd   = total1 + total2;
  const totalTarget = state1.totalTarget + state2.totalTarget;
  const pct         = totalTarget > 0 ? Math.min(Math.round((totalProd / totalTarget) * 100), 100) : 0;
  const active      = (state1.online ? 1 : 0) + (state2.online ? 1 : 0);
  const totalGoodRaw = state1.inputOne + state2.inputOne;
  const totalGood   = Math.max(0, totalGoodRaw - totalRejectFromPackaging);
  const totalZero   = state1.inputZero + state2.inputZero;
  const loadingTimeMs = ((state1.totalTarget || 0) + (state2.totalTarget || 0)) * MS_PER_PCS_PARALEL;
  const avgSetupMs    = Math.round(((state1.setupTime || 0) + (state2.setupTime || 0)) / 2);

  if (el('total-production'))   el('total-production').innerText   = totalProd;
  if (el('total-target'))       el('total-target').innerText       = totalTarget;
  if (el('total-percent'))      el('total-percent').innerText      = pct + '%';
  if (el('active-machines'))    el('active-machines').innerText    = active;
  if (el('total-input-good'))   el('total-input-good').innerText   = totalGood;
  if (el('total-input-zero'))   el('total-input-zero').innerText   = totalZero;
  if (el('total-loading-time')) el('total-loading-time').innerText = formatTime(loadingTimeMs);
  if (el('total-setup-time'))   el('total-setup-time').innerText   = formatTime(avgSetupMs);
}

function updateTimestamp() {
  if (el('update-time')) el('update-time').innerText = new Date().toLocaleTimeString('id-ID');
}

function setMachineStatus(num, online) {
  const s = el('status' + num);
  const m = el('machine' + num);
  if (!s) return;
  if (online) {
    s.innerText = 'ONLINE';
    s.className = 'font-mono text-[9px] tracking-[0.2em] uppercase px-3.5 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25';
    m?.classList.remove('border-white/[0.07]', 'border-red-500/20');
    m?.classList.add('border-emerald-500/20');
  } else {
    s.innerText = 'OFFLINE';
    s.className = 'font-mono text-[9px] tracking-[0.2em] uppercase px-3.5 py-1.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/25';
    m?.classList.remove('border-emerald-500/20', 'border-white/[0.07]');
    m?.classList.add('border-red-500/20');
  }
}

function showResetCountdown(machineName, onComplete) {
  if (_resetInProgress) return;
  _resetInProgress = true;
  let remaining = Math.ceil(RESET_SAVE_DELAY / 1000);
  let n = document.getElementById('reset-countdown-notif');
  if (n) n.remove();
  n = document.createElement('div');
  n.id = 'reset-countdown-notif';
  n.style.cssText =
    'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;' +
    'background:#13171f;border:1px solid rgba(197,168,96,0.4);border-radius:12px;' +
    'padding:14px 24px;display:flex;align-items:center;gap:14px;min-width:320px;' +
    'box-shadow:0 0 30px rgba(197,168,96,0.12)';
  document.body.appendChild(n);

  function updateNotif(sec) {
    n.innerHTML = `
      <span style="font-size:22px">💾</span>
      <div style="flex:1">
        <div style="font-family:DM Mono,monospace;font-size:10px;letter-spacing:0.12em;color:#c5a860;text-transform:uppercase">
          Menyimpan data ${machineName}...
        </div>
        <div style="font-size:12px;color:#7a7870;margin-top:3px">
          Tampilan akan di-reset dalam <strong style="color:#e2ddd5">${sec} detik</strong>
        </div>
        <div style="margin-top:8px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden">
          <div id="reset-cd-bar" style="height:100%;border-radius:2px;background:#c5a860;
            transition:width ${RESET_SAVE_DELAY}ms linear;width:100%"></div>
        </div>
      </div>`;
    requestAnimationFrame(() => {
      const bar = document.getElementById('reset-cd-bar');
      if (bar) requestAnimationFrame(() => { bar.style.width = '0%'; });
    });
  }

  updateNotif(remaining);
  const tick = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      const textEl = n.querySelector('strong');
      if (textEl) textEl.innerText = remaining + ' detik';
    }
  }, 1000);

  setTimeout(() => {
    clearInterval(tick);
    n.remove();
    _resetInProgress = false;
    onComplete();
  }, RESET_SAVE_DELAY);
}

let _pendingInsert = false;

async function handleBothReset() {
  if (_resetInProgress) return;
  if (_dbUpdateTimer)  { clearTimeout(_dbUpdateTimer);  _dbUpdateTimer  = null; }
  if (_dtUpdateTimer)  { clearTimeout(_dtUpdateTimer);  _dtUpdateTimer  = null; }

  await Promise.all([ dbUpdateSessionNow(), dtUpdateSessionNow() ]);

  hideWaitingResetNotif();

  showResetCountdown('Kedua Mesin', async () => {
    clearMachineState('both');
    _pendingInsert = true;
    resetFlags.m1  = false;
    resetFlags.m2  = false;
    dbSessionId    = null;
    localStorage.removeItem(DB_SESSION_KEY);
    dtSessionId    = null;
    localStorage.removeItem(DT_SESSION_KEY);
    showSetupNeededNotif();
  });
}

function showWaitingResetNotif(firstMachineNum) {
  hideWaitingResetNotif();
  const waitNum = firstMachineNum === 1 ? 2 : 1;
  const n = document.createElement('div');
  n.id = 'waiting-reset-notif';
  n.style.cssText =
    'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;' +
    'background:#13171f;border:1px solid rgba(96,165,250,0.4);border-radius:12px;' +
    'padding:14px 24px;display:flex;align-items:center;gap:12px;' +
    'box-shadow:0 0 30px rgba(96,165,250,0.15)';
  n.innerHTML = `<span style="font-size:18px">⏳</span><div>
    <div style="font-family:DM Mono,monospace;font-size:10px;letter-spacing:0.12em;color:#60a5fa;text-transform:uppercase">
      Mesin ${firstMachineNum} sudah di-reset
    </div>
    <div style="font-size:12px;color:#7a7870;margin-top:3px">
      Menunggu Reset Mesin ${waitNum} — data belum disimpan
    </div>
  </div>`;
  document.body.appendChild(n);
}

function hideWaitingResetNotif() {
  document.getElementById('waiting-reset-notif')?.remove();
}

function showSetupNeededNotif() {
  document.getElementById('setup-needed-notif')?.remove();
  const n = document.createElement('div');
  n.id = 'setup-needed-notif';
  n.style.cssText =
    'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;' +
    'background:#13171f;border:1px solid rgba(251,146,60,0.4);border-radius:12px;' +
    'padding:14px 24px;display:flex;align-items:center;gap:12px;' +
    'box-shadow:0 0 30px rgba(251,146,60,0.15)';
  n.innerHTML = `<span style="font-size:18px">📋</span><div>
    <div style="font-family:DM Mono,monospace;font-size:10px;letter-spacing:0.12em;color:#fb923c;text-transform:uppercase">
      Data lama tersimpan — id baru siap
    </div>
    <div style="font-size:12px;color:#7a7870;margin-top:3px">
      Silakan isi shift &amp; produk, lalu tekan Simpan Setup
    </div>
  </div>
  <button onclick="document.getElementById('setup-needed-notif').remove()"
    style="margin-left:8px;background:none;border:none;color:#57534e;cursor:pointer;font-size:16px;padding:4px">✕</button>`;
  document.body.appendChild(n);
}

function clearMachineState(machineNum) {
  if (machineNum === 1 || machineNum === 'both') {
    clearInterval(state1._liveTimer);
    Object.assign(state1, makeState());
    sensor1Enabled = false;
    setMachineStatus(1, false);
  }
  if (machineNum === 2 || machineNum === 'both') {
    clearInterval(state2._liveTimer);
    Object.assign(state2, makeState());
    sensor2Enabled = false;
    setMachineStatus(2, false);
  }
  if (machineNum === 'both') {
    totalRejectFromPackaging = 0;
    mqttClient.publish('oee/reject/total', '0', { retain: true });
  }
  clearDashStateAll();
  updateDisplay1();
  updateDisplay2();
}

// ══════════════════════════════════════════════════════════════
//  MQTT
// ══════════════════════════════════════════════════════════════
const mqttClient = mqtt.connect('ws://192.168.2.92:9002');

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected');
  if (el('mqtt-status')) { el('mqtt-status').innerText = 'Connected'; el('mqtt-status').style.color = '#4ade80'; }
  ['machine1', 'machine2'].forEach(m => {
    ['count','setup','lost','runtime','target','reset','downtime','downtime-start','setup-info','restarted'].forEach(t => {
      mqttClient.subscribe(`oee/${m}/${t}`);
    });
  });
  mqttClient.subscribe('oee/reject/data');
  mqttClient.subscribe('oee/reject/total');
  mqttClient.subscribe('oee/shared-downtime');
  mqttClient.subscribe('oee/machine1/minor');
  mqttClient.subscribe('oee/machine2/minor');
  mqttClient.subscribe('oee/machine1/relay-status');
  mqttClient.subscribe('oee/machine2/relay-status');
});

mqttClient.on('error',     () => { if (el('mqtt-status')) { el('mqtt-status').innerText = 'Error';        el('mqtt-status').style.color = '#f87171'; } });
mqttClient.on('reconnect', () => { if (el('mqtt-status')) { el('mqtt-status').innerText = 'Reconnecting'; el('mqtt-status').style.color = '#fb923c'; } });
mqttClient.on('offline',   () => {
  if (el('mqtt-status')) { el('mqtt-status').innerText = 'Offline'; el('mqtt-status').style.color = '#f87171'; }
  state1.online = state2.online = false;
  setMachineStatus(1, false); setMachineStatus(2, false);
  updateSummary();
});

mqttClient.on('message', async (topic, message) => {
  const payload = message.toString().trim();

  if (topic === 'oee/machine1/restarted') {
    if (payload !== '1') return;
    mqttClient.publish('oee/machine1/restarted', '', { retain: true, qos: 1 });
    return;
  }
  if (topic === 'oee/machine2/restarted') {
    if (payload !== '1') return;
    mqttClient.publish('oee/machine2/restarted', '', { retain: true, qos: 1 });
    return;
  }

  if (topic === 'oee/machine1/setup-info') {
    try {
      const info = JSON.parse(payload);
      setupInfo1 = {
        shift:   info.shift   || 1,
        product: info.product || '-',
        date:    info.date    || new Date().toISOString().split('T')[0],
      };
      renderSetupInfo();
      if (!dtSessionId) await dtInsertSession();
      if (_pendingInsert) {
        _pendingInsert = false;
        document.getElementById('setup-needed-notif')?.remove();
        await dbInsertSession();
      } else if (dbSessionId) {
        document.getElementById('setup-needed-notif')?.remove();
        dbUpdateSession();
      }
    } catch(e) {}
    return;
  }
  if (topic === 'oee/machine2/setup-info') {
    try {
      const info = JSON.parse(payload);
      setupInfo2 = {
        shift:   info.shift   || 1,
        product: info.product || '-',
        date:    info.date    || new Date().toISOString().split('T')[0],
      };
      renderSetupInfo();
      if (dbSessionId) dbUpdateSession();
    } catch(e) {}
    return;
  }

  if (topic === 'oee/machine1/relay-status') {
    sensor1Enabled = (payload === 'ON');
    saveDashState();
  }

  if (topic === 'oee/machine1/count') {
    if (!sensor1Enabled) return;
    state1.online = true; setMachineStatus(1, true); lastMsg1 = Date.now();
    if (payload === '1') { state1.inputOne++;  stopZeroTrack(state1, 1); }
    else                 { state1.inputZero++; startZeroTrack(state1, 1); }
    updateDisplay1();
  }
  if (topic === 'oee/machine1/setup')   { state1.setupTime   = parseInt(payload) || 0; updateDisplay1(); }
  if (topic === 'oee/machine1/runtime') { state1.runtime     = parseInt(payload) || 0; updateDisplay1(); }
  if (topic === 'oee/machine1/target')  { state1.totalTarget = parseInt(payload) || 0; updateDisplay1(); dbUpdateSession(); }
  if (topic === 'oee/machine1/downtime-start') { state1.inDowntime = true; }

  if (topic === 'oee/machine1/downtime') {
    try {
      const ev = JSON.parse(payload);
      if (ev.downtime_total != null) state1.downtimeAcc       = ev.downtime_total;
      if (ev.minor_total   != null)  state1.minorBreakdownAcc = ev.minor_total;
      state1.minorBreakdownWatch = 0;
      state1.inDowntime = false;
      if (el('downtime1')) el('downtime1').innerText = formatTime(state1.downtimeAcc);
      updateDisplay1(); dbUpdateSession();
    } catch(e) {}
  }

  if (topic === 'oee/machine1/reset') {
    if (resetFlags.m1) return;
    resetFlags.m1 = true;
    if (bothReset()) await handleBothReset();
    else showWaitingResetNotif(1);
  }

  if (topic === 'oee/machine2/relay-status') {
    sensor2Enabled = (payload === 'ON');
    saveDashState();
  }

  if (topic === 'oee/machine2/count') {
    if (!sensor2Enabled) return;
    state2.online = true; setMachineStatus(2, true); lastMsg2 = Date.now();
    if (payload === '1') { state2.inputOne++;  stopZeroTrack(state2, 2); }
    else                 { state2.inputZero++; startZeroTrack(state2, 2); }
    updateDisplay2();
  }
  if (topic === 'oee/machine2/setup')   { state2.setupTime   = parseInt(payload) || 0; updateDisplay2(); }
  if (topic === 'oee/machine2/runtime') { state2.runtime     = parseInt(payload) || 0; updateDisplay2(); }
  if (topic === 'oee/machine2/target')  { state2.totalTarget = parseInt(payload) || 0; updateDisplay2(); dbUpdateSession(); }
  if (topic === 'oee/machine2/downtime-start') { state2.inDowntime = true; }

  if (topic === 'oee/machine2/downtime') {
    try {
      const ev = JSON.parse(payload);
      if (ev.downtime_total != null) state2.downtimeAcc       = ev.downtime_total;
      if (ev.minor_total   != null)  state2.minorBreakdownAcc = ev.minor_total;
      state2.minorBreakdownWatch = 0;
      state2.inDowntime = false;
      if (el('downtime2')) el('downtime2').innerText = formatTime(state2.downtimeAcc);
      updateDisplay2(); dbUpdateSession();
    } catch(e) {}
  }

  if (topic === 'oee/machine2/reset') {
    if (resetFlags.m2) return;
    resetFlags.m2 = true;
    if (bothReset()) await handleBothReset();
    else showWaitingResetNotif(2);
  }

  if (topic === 'oee/shared-downtime') {
    try {
      const ev     = JSON.parse(payload);
      const durasi = ev.durasi_ms || 0;
      if (durasi > state1.downtimeAcc) state1.downtimeAcc = durasi;
      if (durasi > state2.downtimeAcc) state2.downtimeAcc = durasi;
      updateDisplay1(); updateDisplay2();
    } catch(e) {}
  }

  if (topic === 'oee/machine1/minor') {
    try {
      const ev = JSON.parse(payload);
      if (ev.minor_total != null) state1.minorBreakdownAcc = ev.minor_total;
      state1.inDowntime = false;
      updateDisplay1();
    } catch(e) {}
  }
  if (topic === 'oee/machine2/minor') {
    try {
      const ev = JSON.parse(payload);
      if (ev.minor_total != null) state2.minorBreakdownAcc = ev.minor_total;
      state2.inDowntime = false;
      updateDisplay2();
    } catch(e) {}
  }

  if (topic === 'oee/reject/total') {
    const val = parseInt(payload) || 0;
    if (val !== totalRejectFromPackaging) {
      totalRejectFromPackaging = val;
      updateSummary(); updateOEE();
      saveDashState(); dbUpdateSession();
    }
  }

  if (topic === 'oee/reject/data') {
    try {
      const rec = JSON.parse(payload);
      console.log(`[Dashboard] Reject data — total=${rec.totalReject}`);
    } catch(e) {}
  }
});

let lastMsg1 = 0, lastMsg2 = 0;

setInterval(() => {
  const now = Date.now();
  if (state1.online && now - lastMsg1 > 30000) { state1.online = false; setMachineStatus(1, false); updateSummary(); }
  if (state2.online && now - lastMsg2 > 30000) { state2.online = false; setMachineStatus(2, false); updateSummary(); }
}, 5000);

// ── Auto re-sync dari server setiap 5 menit (untuk laptop yang baru buka)
setInterval(async () => {
  if (!_tabActive) return;
  if (dbSessionId) {
    try {
      const detailRes  = await fetch(`${API_BASE}/session/${dbSessionId}`);
      const detailData = await detailRes.json();
      if (detailData.ok && detailData.data) {
        const d = detailData.data;
        // Hanya update jika nilai server lebih besar (MQTT real-time bisa sudah lebih maju)
        const serverGood = (d.finish_goods || 0) + (d.total_reject || 0);
        const localGood  = state1.inputOne + state2.inputOne;
        if (serverGood > localGood) {
          state1.inputOne = Math.round(serverGood / 2);
          state2.inputOne = serverGood - state1.inputOne;
          console.log('[Dashboard] Re-sync counter dari server:', serverGood);
          updateDisplay1(); updateDisplay2();
        }
        // Update reject
        const serverReject = d.total_reject || 0;
        if (serverReject !== totalRejectFromPackaging) {
          totalRejectFromPackaging = serverReject;
          updateSummary(); updateOEE();
        }
      }
    } catch(e) {}
  }
}, 5 * 60 * 1000);

// ── Gauge
function drawGauge(canvasId, pct, color) {
  const canvas = el(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H - 10;
  const r  = Math.min(W * 0.42, H * 0.88);
  ctx.clearRect(0, 0, W, H);

  const START = Math.PI;
  const END   = 2 * Math.PI;

  ctx.beginPath(); ctx.arc(cx, cy, r, START, END);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke();

  [
    { f: 0,    t: 0.45, c: 'rgba(248,113,113,0.18)' },
    { f: 0.45, t: 0.65, c: 'rgba(251,146,60,0.18)'  },
    { f: 0.65, t: 0.85, c: 'rgba(250,204,21,0.18)'  },
    { f: 0.85, t: 1,    c: 'rgba(74,222,128,0.18)'  },
  ].forEach(z => {
    ctx.beginPath(); ctx.arc(cx, cy, r, START + z.f * Math.PI, START + z.t * Math.PI);
    ctx.strokeStyle = z.c; ctx.lineWidth = 16; ctx.lineCap = 'butt'; ctx.stroke();
  });

  const c = Math.min(Math.max(pct, 0), 100);
  if (c > 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r, START, START + (c / 100) * Math.PI);
    ctx.strokeStyle = color; ctx.lineWidth = 16; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.stroke(); ctx.shadowBlur = 0;
  }

  [0, 25, 50, 75, 100].forEach(t => {
    const a = START + (t / 100) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx + (r - 22) * Math.cos(a), cy + (r - 22) * Math.sin(a));
    ctx.lineTo(cx + (r - 8)  * Math.cos(a), cy + (r - 8)  * Math.sin(a));
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.stroke();
  });

  const na = START + (c / 100) * Math.PI;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (r - 26) * Math.cos(na), cy + (r - 26) * Math.sin(na));
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;

  ctx.font = '400 9px "DM Mono",monospace'; ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['0', START], ['50', START + 0.5 * Math.PI], ['100', END]].forEach(([label, angle]) => {
    ctx.fillText(label, cx + (r + 18) * Math.cos(angle), cy + (r + 18) * Math.sin(angle));
  });
}

function oeeLabel(p) {
  if (p >= 85) return 'World Class ✦';
  if (p >= 65) return 'Good';
  if (p >= 45) return 'Average';
  return 'Below Average';
}
function gaugeColor(p) {
  if (p >= 85) return '#4ade80';
  if (p >= 65) return '#facc15';
  if (p >= 45) return '#fb923c';
  return '#f87171';
}

function updateOEE() {
  const rawGood          = state1.inputOne + state2.inputOne;
  const loadingTimeMs    = ((state1.totalTarget || 0) + (state2.totalTarget || 0)) * MS_PER_PCS_PARALEL;
  const avgSetupMs       = ((state1.setupTime || 0) + (state2.setupTime || 0)) / 2;
  const totalBreakdownMs = (state1.downtimeAcc || 0) + (state2.downtimeAcc || 0);

  const ar = loadingTimeMs > 0
    ? Math.max(((loadingTimeMs - avgSetupMs - totalBreakdownMs) / loadingTimeMs) * 100, 0) : 0;

  const operatingTimeMs    = Math.max(loadingTimeMs - avgSetupMs - totalBreakdownMs, 0);
  const mbLiveM1           = state1.minorBreakdownAcc + (!state1.inDowntime ? getWatchTotal(state1) : (state1.minorBreakdownWatch || 0));
  const mbLiveM2           = state2.minorBreakdownAcc + (!state2.inDowntime ? getWatchTotal(state2) : (state2.minorBreakdownWatch || 0));
  const avgMinorMs         = (mbLiveM1 + mbLiveM2) / 2;
  const netOperatingTimeMs = Math.max(operatingTimeMs - avgMinorMs, 0);

  const pr = operatingTimeMs > 0
    ? Math.min((netOperatingTimeMs / operatingTimeMs) * 100, 100) : 0;

  if (el('total-operating-time'))     el('total-operating-time').innerText     = formatTime(operatingTimeMs);
  if (el('total-net-operating-time')) el('total-net-operating-time').innerText = formatTime(netOperatingTimeMs);

  const netOpMenit = netOperatingTimeMs / 60000;
  const qr = netOpMenit > 0
    ? Math.max(Math.min((1 - (totalRejectFromPackaging / 58) / netOpMenit) * 100, 100), 0) : 0;

  const oee  = (ar / 100) * (pr / 100) * (qr / 100) * 100;
  const arR  = Math.round(ar), prR = Math.round(pr), qrR = Math.round(qr), oeeR = Math.round(oee);

  drawGauge('gauge-ar', arR, gaugeColor(arR));
  drawGauge('gauge-pr', prR, '#60a5fa');
  drawGauge('gauge-qr', qrR, '#a78bfa');
  if (el('ar-value')) { el('ar-value').innerText = arR + '%'; el('ar-value').style.color = gaugeColor(arR); }
  if (el('pr-value'))  el('pr-value').innerText  = prR + '%';
  if (el('qr-value'))  el('qr-value').innerText  = qrR + '%';
  if (el('ar-label'))  el('ar-label').innerText  = oeeLabel(arR);
  if (el('pr-label'))  el('pr-label').innerText  = oeeLabel(prR);
  if (el('qr-label'))  el('qr-label').innerText  = oeeLabel(qrR);
  if (el('oee-value')) el('oee-value').innerText = oeeR + '%';
  if (el('oee-bar'))   el('oee-bar').style.width = Math.min(oeeR, 100) + '%';
  saveDashState();
}

// ══════════════════════════════════════════════════════════════
//  DB SESSION
// ══════════════════════════════════════════════════════════════
const API_BASE       = `http://${window.location.hostname}:3000/api`;
const DB_SESSION_KEY = 'oee_dashboard_session_id';

let dbSessionId    = null;
let dbSaveInterval = null;
let _dbInsertLock  = false;

function getDbPayload() {
  const totalTarget = (state1.totalTarget || 0) + (state2.totalTarget || 0);
  const rawGood     = (state1.inputOne   || 0) + (state2.inputOne   || 0);
  const finishGoods = Math.max(0, rawGood - totalRejectFromPackaging);
  const avgSetupMs  = ((state1.setupTime || 0) + (state2.setupTime || 0)) / 2;
  const totalDtMs   = (state1.downtimeAcc || 0) + (state2.downtimeAcc || 0);
  const mbLiveM1    = (state1.minorBreakdownAcc || 0) + getWatchTotal(state1);
  const mbLiveM2    = (state2.minorBreakdownAcc || 0) + getWatchTotal(state2);
  const avgMinorMs  = (mbLiveM1 + mbLiveM2) / 2;
  return {
    tgl_produksi:       setupInfo1.date    || new Date().toISOString().split('T')[0],
    shift:              setupInfo1.shift   || 1,
    product:            setupInfo1.product || '-',
    target_m1:          state1.totalTarget || 0,
    target_m2:          state2.totalTarget || 0,
    finish_goods:       finishGoods,
    total_reject:       totalRejectFromPackaging || 0,
    setup_time_ms:      Math.round(avgSetupMs),
    minor_breakdown_ms: Math.round(avgMinorMs),
    downtime_ms:        Math.round(totalDtMs),
  };
}

async function dbInsertSession() {
  if (_dbInsertLock) return;
  _dbInsertLock = true;
  localStorage.setItem(DB_SESSION_KEY, 'pending');
  try {
    // Cek dulu apakah sudah ada — jangan dobel insert
    const tgl   = setupInfo1.date  || new Date().toISOString().split('T')[0];
    const shift = setupInfo1.shift || 1;
    try {
      const chk  = await fetch(`${API_BASE}/session/active?tgl=${tgl}&shift=${shift}`);
      const chkD = await chk.json();
      if (chkD.ok && chkD.session_id) {
        dbSessionId = chkD.session_id;
        localStorage.setItem(DB_SESSION_KEY, String(dbSessionId));
        startDbSaveInterval();
        return;
      }
    } catch(e) {}

    const res  = await fetch(`${API_BASE}/session/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getDbPayload()),
    });
    const data = await res.json();
    if (data.ok) {
      dbSessionId = data.session_id;
      localStorage.setItem(DB_SESSION_KEY, String(dbSessionId));
      startDbSaveInterval();
    } else {
      localStorage.removeItem(DB_SESSION_KEY);
    }
  } catch(err) {
    localStorage.removeItem(DB_SESSION_KEY);
  } finally {
    _dbInsertLock = false;
  }
}

let _dbUpdateTimer = null;
function dbUpdateSession() {
  if (!dbSessionId || !_tabActive) return;
  if (_dbUpdateTimer) return;
  _dbUpdateTimer = setTimeout(async () => {
    _dbUpdateTimer = null;
    if (!_tabActive) return;
    try {
      const res  = await fetch(`${API_BASE}/session/${dbSessionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getDbPayload()),
      });
      const data = await res.json();
      if (data.ok) console.log(`[DB] UPDATE id=${dbSessionId} OEE=${data.oee?.oee}%`);
    } catch(err) {}
  }, 10000);
}

async function dbUpdateSessionNow() {
  if (!dbSessionId || !_tabActive) return;
  try {
    await fetch(`${API_BASE}/session/${dbSessionId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getDbPayload()), keepalive: true,
    });
  } catch(err) {}
}

window.addEventListener('beforeunload', () => { dbUpdateSessionNow(); });

function startDbSaveInterval() {
  if (dbSaveInterval) clearInterval(dbSaveInterval);
  dbSaveInterval = setInterval(dbUpdateSession, 60 * 1000);
}

// ── Downtime session
const DT_SESSION_KEY = 'oee_downtime_session_id';
let dtSessionId    = null;
let _dtUpdateTimer = null;

function getDtPayload() {
  const avgSetupMs = ((state1.setupTime || 0) + (state2.setupTime || 0)) / 2;
  const totalDtMs  = (state1.downtimeAcc || 0) + (state2.downtimeAcc || 0);
  const mbLiveM1   = (state1.minorBreakdownAcc || 0) + getWatchTotal(state1);
  const mbLiveM2   = (state2.minorBreakdownAcc || 0) + getWatchTotal(state2);
  const avgMinorMs = (mbLiveM1 + mbLiveM2) / 2;
  return {
    tgl_produksi:      setupInfo1.date    || new Date().toISOString().split('T')[0],
    shift:             setupInfo1.shift   || 1,
    product:           setupInfo1.product || '-',
    total_minor_ms:    Math.round(avgMinorMs),
    total_setup_ms:    Math.round(avgSetupMs),
    total_downtime_ms: Math.round(totalDtMs),
  };
}

let _dtInsertLock = false;
 
async function dtInsertSession() {
  if (dtSessionId) return;
  if (_dtInsertLock) {
    await new Promise(r => setTimeout(r, 500));
    return;
  }
  _dtInsertLock = true;
  try {
    const tgl   = setupInfo1.date  || new Date().toISOString().split('T')[0];
    const shift = setupInfo1.shift || 1;
 
    // Step 1: tanya server — ada session aktif untuk tgl+shift ini?
    try {
      const chkRes  = await fetch(`${API_BASE}/downtime/active?tgl=${tgl}&shift=${shift}`);
      const chkData = await chkRes.json();
      if (chkData.ok && chkData.session_id) {
        dtSessionId = chkData.session_id;
        localStorage.setItem(DT_SESSION_KEY, String(dtSessionId));
        console.log(`[DB Downtime] ✅ Pakai session aktif id=${dtSessionId} (tidak INSERT baru)`);
        return;
      }
    } catch(e) {
      console.warn('[DB Downtime] Gagal cek /downtime/active:', e.message);
    }
 
    // Step 2: belum ada → POST ke server
    // Server juga punya guard di route-nya, aman dari race condition
    const res  = await fetch(`${API_BASE}/downtime/update/start`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(getDtPayload()),
    });
    const data = await res.json();
    if (data.ok) {
      dtSessionId = data.session_id;
      localStorage.setItem(DT_SESSION_KEY, String(dtSessionId));
      const label = data.reused ? 'Reused' : 'INSERT baru';
      console.log(`[DB Downtime] ✅ ${label} id=${dtSessionId}`);
    }
  } catch(err) {
    console.warn('[DB Downtime] dtInsertSession error:', err.message);
  } finally {
    _dtInsertLock = false;
  }
}

function dtUpdateSession() {
  if (!dtSessionId) return;
  if (_dtUpdateTimer) return;
  _dtUpdateTimer = setTimeout(async () => {
    _dtUpdateTimer = null;
    try {
      await fetch(`${API_BASE}/downtime/update/${dtSessionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getDtPayload()),
      });
    } catch(err) {}
  }, 10000);
}

async function dtUpdateSessionNow() {
  if (!dtSessionId) return;
  try {
    await fetch(`${API_BASE}/downtime/update/${dtSessionId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getDtPayload()), keepalive: true,
    });
  } catch(err) {}
}

let _tabActive = true;
(function initTabSingleton() {
  try {
    const ch = new BroadcastChannel('oee_dashboard_tab');
    ch.postMessage('takeover');
    ch.onmessage = (e) => {
      if (e.data === 'takeover') {
        _tabActive = false;
        if (dbSaveInterval) { clearInterval(dbSaveInterval); dbSaveInterval = null; }
        if (_dbUpdateTimer)  { clearTimeout(_dbUpdateTimer);  _dbUpdateTimer  = null; }
        let banner = document.getElementById('tab-inactive-banner');
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'tab-inactive-banner';
          banner.style.cssText =
            'position:fixed;bottom:0;left:0;right:0;z-index:99999;' +
            'background:#1a0a0a;border-top:1px solid rgba(248,113,113,0.4);' +
            'padding:10px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px';
          banner.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:16px">⚠️</span>
              <div>
                <span style="font-family:DM Mono,monospace;font-size:10px;letter-spacing:0.1em;color:#f87171;text-transform:uppercase">
                  Tab tidak aktif
                </span>
                <span style="font-size:12px;color:#7a7870;margin-left:10px">
                  Dashboard ini tidak menyimpan ke DB — tutup tab lain atau
                </span>
              </div>
            </div>
            <button onclick="location.reload()"
              style="padding:6px 16px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);
                     border-radius:8px;color:#f87171;font-family:DM Mono,monospace;font-size:11px;
                     cursor:pointer;white-space:nowrap">
              Aktifkan Tab Ini
            </button>`;
          document.body.appendChild(banner);
        }
      }
    };
  } catch(e) {}
})();

(async function init() {
  ['oee_mesin1_session_id', 'oee_mesin2_session_id'].forEach(k => {
    try { localStorage.removeItem(k); } catch(e) {}
  });
  loadLocalSensorState();
  await syncStateFromServer();
  updateDisplay1();
  updateDisplay2();
  updateOEE();
  renderSetupInfo();
})();

setInterval(() => {
  const anyActive = (state1.watchStart !== null) || (state2.watchStart !== null);
  if (anyActive) updateOEE();
}, 500);

setInterval(() => {
  const mbA = state1.minorBreakdownAcc + ((!state1.inDowntime && state1.watchStart !== null) ? getWatchTotal(state1) : state1.minorBreakdownWatch);
  const mbB = state2.minorBreakdownAcc + ((!state2.inDowntime && state2.watchStart !== null) ? getWatchTotal(state2) : state2.minorBreakdownWatch);
  if (el('total-minor-breakdown')) el('total-minor-breakdown').innerText = formatTime(Math.round((mbA + mbB) / 2));

  const dtA = state1.downtimeAcc + ((state1.inDowntime && state1.watchStart !== null) ? getWatchTotal(state1) : 0);
  const dtB = state2.downtimeAcc + ((state2.inDowntime && state2.watchStart !== null) ? getWatchTotal(state2) : 0);
  if (el('total-downtime')) el('total-downtime').innerText = formatTime(Math.round((dtA + dtB) / 2));
}, 500);

setInterval(saveDashState, 10000);
setInterval(() => { if (dtSessionId) dtUpdateSession(); }, 60000);

console.log('✅ dashboard.js — sync state dari server saat page load');