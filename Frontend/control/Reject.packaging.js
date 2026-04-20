document.addEventListener('DOMContentLoaded', () => {
  const MS_PER_PCS_PARALEL = 1034;
  const STORAGE_KEY        = 'reject_pkg_state';
  const API_BASE           = `http://${window.location.hostname}:3000/api`;

  const REJECT_TYPES = [
    { key: 'Kosong',             elId: 'Kosong',            color: '#f87171', dbKey: 'kosong'       },
    { key: 'Coding',             elId: 'Coding',            color: '#fb923c', dbKey: 'coding'       },
    { key: 'Seal',               elId: 'Seal',              color: '#fbbf24', dbKey: 'seal'         },
    { key: 'Kurang Angin',       elId: 'KurangAngin',       color: '#a78bfa', dbKey: 'kurang_angin' },
    { key: 'Gramasi Unstandart', elId: 'GramasiUnstandart', color: '#60a5fa', dbKey: 'gramasi'      },
    { key: 'Lain-lain',          elId: 'Lainlain',          color: '#4ade80', dbKey: 'lain_lain'    },
  ];

  const mState = {
    m1: { inputOne: 0, inputZero: 0, target: 0, runtime: 0 },
    m2: { inputOne: 0, inputZero: 0, target: 0, runtime: 0 },
  };

  let setupInfo = {
    shift:   1,
    product: '-',
    date:    new Date().toISOString().split('T')[0],
  };

  const rVal = {};
  REJECT_TYPES.forEach(r => (rVal[r.key] = 0));

  let totalSubmittedReject    = 0;
  let hasSubmittedThisSession = false;
  let hist = JSON.parse(localStorage.getItem('reject_pkg_hist') || '[]');

  const resetFlags = { m1: false, m2: false };

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mState, setupInfo,
        totalSubmittedReject, hasSubmittedThisSession,
        savedAt: Date.now(),
      }));
    } catch(e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (snap.mState?.m1) Object.assign(mState.m1, snap.mState.m1);
      if (snap.mState?.m2) Object.assign(mState.m2, snap.mState.m2);
      if (snap.setupInfo)  setupInfo = snap.setupInfo;
      totalSubmittedReject    = snap.totalSubmittedReject    || 0;
      hasSubmittedThisSession = snap.hasSubmittedThisSession || false;
    } catch(e) { console.warn('[Reject] Gagal load state:', e); }
  }

  loadState();

  const el      = id => document.getElementById(id);
  const setText = (id, val) => { const e = el(id); if (e) e.innerText = val; };

  function derived() {
    const totalProd   = (mState.m1.inputOne + mState.m1.inputZero)
                      + (mState.m2.inputOne + mState.m2.inputZero);
    const totalGood1  = mState.m1.inputOne + mState.m2.inputOne;
    const totalTarget = mState.m1.target   + mState.m2.target;
    const rejectForm  = REJECT_TYPES.reduce((s, r) => s + (rVal[r.key] || 0), 0);
    const totalReject = totalSubmittedReject + rejectForm;
    const netGood     = Math.max(0, totalGood1 - totalReject);

    const qr = totalProd > 0
      ? Math.min((totalGood1 / totalProd) * 100, 100).toFixed(2) : '0.00';

    const actualRuntimeMs = Math.max(mState.m1.runtime || 0, mState.m2.runtime || 0);
    const runtimeSec      = actualRuntimeMs / 1000;
    const pr = runtimeSec > 0
      ? Math.min(((netGood * (MS_PER_PCS_PARALEL / 1000)) / runtimeSec) * 100, 100).toFixed(2)
      : '0.00';

    return { totalProd, totalGood1, totalTarget, totalReject, rejectForm, netGood, qr, pr };
  }

  function updateDisplay() {
    const d = derived();
    setText('disp-produksi', d.totalProd);
    setText('disp-target',   d.totalTarget);
    setText('disp-good',     d.netGood);
    setText('disp-reject',   d.totalReject);
    setText('sum-reject',    d.rejectForm);
    setText('sum-good-net',  d.netGood);

    REJECT_TYPES.forEach(r => {
      const e = el('rv-' + r.elId);
      if (e) e.innerText = rVal[r.key] || 0;
    });

    renderBreakdown(d.totalReject);
    updateChart();
    saveState();
  }

  function renderBreakdown(totalReject) {
    const container = el('breakdown-container');
    if (!container) return;
    container.innerHTML = '';
    REJECT_TYPES.forEach(r => {
      const val = rVal[r.key] || 0;
      const pct = totalReject > 0 ? ((val / totalReject) * 100).toFixed(1) : 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px';
      row.innerHTML = `
        <div style="width:130px;font-family:'DM Mono',monospace;font-size:11px;
                    color:${r.color};white-space:nowrap;overflow:hidden;
                    text-overflow:ellipsis;letter-spacing:.04em">${r.key}</div>
        <div style="flex:1;background:rgba(255,255,255,.05);border-radius:5px;height:8px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${r.color};border-radius:5px;
                      transition:width .5s cubic-bezier(.4,0,.2,1);
                      box-shadow:0 0 8px ${r.color}66"></div>
        </div>
        <div style="width:44px;text-align:right;font-family:'DM Mono',monospace;
                    font-size:13px;font-weight:300;color:#d6d3d1">${val}</div>
        <div style="width:40px;text-align:right;font-family:'DM Mono',monospace;
                    font-size:10px;color:#57534e">${pct}%</div>`;
      container.appendChild(row);
    });
  }

  let barChart = null;

  function initChart() {
    const ctx = el('barChart')?.getContext('2d');
    if (!ctx) return;
    barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: REJECT_TYPES.map(r => r.key),
        datasets: [{
          label: 'Pcs Reject',
          data: REJECT_TYPES.map(() => 0),
          backgroundColor: REJECT_TYPES.map(r => r.color + '40'),
          borderColor:     REJECT_TYPES.map(r => r.color),
          borderWidth: 2, borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color:'#57534e', font:{ family:'DM Mono', size:10 } }, grid: { color:'rgba(255,255,255,0.04)' } },
          y: { ticks: { color:'#57534e', font:{ family:'DM Mono' } },          grid: { color:'rgba(255,255,255,0.04)' }, beginAtZero: true }
        }
      }
    });
  }

  function updateChart() {
    if (!barChart) return;
    barChart.data.datasets[0].data = REJECT_TYPES.map(r => rVal[r.key] || 0);
    barChart.update();
  }

  function renderHistory() {
    const tbody = el('history-body');
    if (!tbody) return;

    if (!hist.length) {
      tbody.innerHTML = `<tr><td colspan="10"
        style="font-family:'DM Mono',monospace;font-size:11px;color:#57534e;text-align:center;padding:40px">
        Belum ada data tersimpan</td></tr>`;
      return;
    }

    const tdBase = 'padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.04);font-family:"DM Mono",monospace;font-size:12px;';
    const detailColors = {
      'Kosong':'#f87171','Coding':'#fb923c','Seal':'#fbbf24',
      'Kurang Angin':'#a78bfa','Gramasi Unstandart':'#60a5fa','Lain-lain':'#4ade80'
    };

    tbody.innerHTML = hist.map((rec, i) => {
      const realIdx  = hist.length - 1 - i;
      const rowNum   = hist.length - i;
      const detailId = `detail-row-${realIdx}`;
      const rejectBasis = rec.rejectThisSubmit ?? rec.totalReject ?? 0;

      const detailHtml = rec.detail
        ? Object.entries(rec.detail).filter(([k, v]) => v > 0).map(([k, v]) => {
            const pct = rejectBasis > 0 ? ((v / rejectBasis) * 100).toFixed(0) : 0;
            const c   = detailColors[k] || '#d6d3d1';
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
              <div style="width:110px;font-family:'DM Mono',monospace;font-size:10px;color:${c}">${k}</div>
              <div style="flex:1;background:rgba(255,255,255,.05);border-radius:4px;height:6px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:${c};border-radius:4px"></div>
              </div>
              <div style="width:35px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:${c}">${v}</div>
              <div style="width:35px;text-align:right;font-family:'DM Mono',monospace;font-size:10px;color:#57534e">${pct}%</div>
            </div>`;
          }).join('')
        : '<div style="font-family:DM Mono,monospace;font-size:11px;color:#57534e">Tidak ada data detail</div>';

      const hasDetail  = rec.detail && Object.values(rec.detail).some(v => v > 0);
      const savedBadge = rec.savedToDb
        ? `<span style="font-family:DM Mono,monospace;font-size:9px;color:#4ade80;
                        background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);
                        border-radius:4px;padding:1px 6px;margin-left:6px">✓ DB</span>`
        : '';

      return `
      <tr id="row-${realIdx}" style="transition:background .15s"
          onmouseover="this.style.background='rgba(255,255,255,.02)'"
          onmouseout="this.style.background=''">
        <td style="${tdBase}color:#57534e">${rowNum}</td>
        <td style="${tdBase}color:#57534e;font-size:10px;white-space:nowrap">${rec.time}${savedBadge}</td>
        <td style="${tdBase}color:#4ade80">${rec.totalProd}</td>
        <td style="${tdBase}color:#4ade80">${rec.totalGood1}</td>
        <td style="${tdBase}">
          <span style="display:inline-flex;align-items:center;gap:6px">
            <span style="color:#f87171;font-family:'DM Mono',monospace">${rec.totalReject}</span>
            ${hasDetail ? `<button onclick="toggleDetail('${detailId}')"
              id="btn-${detailId}"
              style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);
                     color:#f87171;border-radius:5px;padding:1px 7px;font-family:'DM Mono',monospace;
                     font-size:9px;letter-spacing:.06em;cursor:pointer"
              onmouseover="this.style.background='rgba(248,113,113,.18)'"
              onmouseout="this.style.background='rgba(248,113,113,.08)'">&#9662; detail</button>` : ''}
          </span>
        </td>
        <td style="${tdBase}color:#4ade80">${rec.goodBersih}</td>
        <td style="${tdBase}color:#a78bfa">${rec.qr}%</td>
        <td style="${tdBase}color:#60a5fa">${rec.pr}%</td>
        <td style="${tdBase}">
          <span style="display:inline-block;padding:2px 9px;border-radius:5px;font-size:10px;
            letter-spacing:.08em;background:rgba(248,113,113,.12);color:#f87171;
            border:1px solid rgba(248,113,113,.25);white-space:nowrap">
            ${rec.biggestReject}
          </span>
        </td>
        <td style="${tdBase}">
          <button onclick="deleteHistoryRecord(${realIdx})"
            style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);
                   color:#f87171;border-radius:7px;padding:4px 10px;
                   font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;
                   cursor:pointer;white-space:nowrap"
            onmouseover="this.style.background='rgba(248,113,113,.18)';this.style.borderColor='rgba(248,113,113,.4)'"
            onmouseout="this.style.background='rgba(248,113,113,.08)';this.style.borderColor='rgba(248,113,113,.2)'">
            &#10005; Hapus
          </button>
        </td>
      </tr>
      ${hasDetail ? `
      <tr id="${detailId}" style="display:none">
        <td colspan="10" style="padding:0 12px 14px 40px;border-bottom:1px solid rgba(255,255,255,.04)">
          <div style="background:rgba(248,113,113,.04);border:1px solid rgba(248,113,113,.1);
                      border-radius:10px;padding:14px 16px;margin-top:4px">
            <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.18em;
                        color:#f87171;text-transform:uppercase;margin-bottom:10px">
              Breakdown Reject &mdash; ${rec.time}
            </div>
            ${detailHtml}
            <div style="display:flex;justify-content:flex-end;margin-top:10px;
                        font-family:'DM Mono',monospace;font-size:10px;color:#57534e;
                        border-top:1px solid rgba(255,255,255,.05);padding-top:8px">
              Submit ini: <span style="color:#f87171;margin-left:8px">${rejectBasis} pcs</span>
              &nbsp;|&nbsp; Total Akumulasi: <span style="color:#fb923c;margin-left:8px">${rec.totalReject} pcs</span>
              &nbsp;|&nbsp; Net Good: <span style="color:#4ade80;margin-left:8px">${rec.goodBersih} pcs</span>
            </div>
          </div>
        </td>
      </tr>` : ''}`;
    }).join('');
  }

  window.toggleDetail = function (detailId) {
    const row = document.getElementById(detailId);
    const btn = document.getElementById('btn-' + detailId);
    if (!row) return;
    const isHidden = row.style.display === 'none';
    row.style.display = isHidden ? 'table-row' : 'none';
    if (btn) btn.innerText = isHidden ? '\u25b4 tutup' : '\u25be detail';
  };

  window.deleteHistoryRecord = function (index) {
    if (!confirm('Hapus data riwayat ini?')) return;
    hist.splice(index, 1);
    localStorage.setItem('reject_pkg_hist', JSON.stringify(hist));
    renderHistory();
    showToast('\u2713 Data riwayat dihapus', '#f87171');
  };

  window.clearAllHistory = function () {
    if (!confirm('Hapus SEMUA riwayat submit?\nTindakan ini tidak bisa dibatalkan.')) return;
    hist = [];
    localStorage.removeItem('reject_pkg_hist');
    renderHistory();
    showToast('\u2713 Semua riwayat dihapus', '#f87171');
  };

  window.submitReject = async function () {
    const d = derived();

    if (d.totalProd === 0 && d.totalGood1 === 0) {
      alert('Belum ada data produksi dari mesin.\nPastikan mesin online & MQTT terhubung.');
      return;
    }

    let biggestReject = '-', biggestVal = 0;
    REJECT_TYPES.forEach(r => {
      if ((rVal[r.key] || 0) > biggestVal) {
        biggestVal    = rVal[r.key] || 0;
        biggestReject = r.key;
      }
    });

    const rejectThisSubmit  = d.rejectForm;
    totalSubmittedReject   += rejectThisSubmit;
    hasSubmittedThisSession = true;
    const newNetGood        = Math.max(0, d.totalGood1 - totalSubmittedReject);

    let savedToDb = false;
    try {
      const dbPayload = {

        tgl_produksi: setupInfo.date    || new Date().toISOString().split('T')[0],
        shift:        setupInfo.shift   || 1,
        product:      setupInfo.product || '-',
        target:       d.totalTarget,

        kosong:       rVal['Kosong']             || 0,
        coding:       rVal['Coding']             || 0,
        seal:         rVal['Seal']               || 0,
        kurang_angin: rVal['Kurang Angin']       || 0,
        gramasi:      rVal['Gramasi Unstandart'] || 0,
        lain_lain:    rVal['Lain-lain']          || 0,
      };

      const res  = await fetch(`${API_BASE}/reject/submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(dbPayload),
      });
      const data = await res.json();
      if (data.ok) {
        savedToDb = true;
        console.log(`[Reject DB] ✅ INSERT id=${data.reject_id} total=${data.total_reject}`);
      } else {
        console.warn('[Reject DB] INSERT gagal:', data.error);
      }
    } catch(err) {
      console.warn('[Reject DB] POST error:', err.message);
    }

    const record = {
      time:             new Date().toLocaleString('id-ID'),
      totalProd:        d.totalProd,
      totalGood1:       d.totalGood1,
      totalTarget:      d.totalTarget,
      totalReject:      totalSubmittedReject,
      rejectThisSubmit: rejectThisSubmit,
      goodBersih:       newNetGood,
      netGood:          newNetGood,
      qr:               d.qr,
      pr:               d.pr,
      biggestReject:    biggestVal > 0 ? `${biggestReject} (${biggestVal})` : '-',
      detail:           { ...rVal },
      savedToDb,
    };

    hist.unshift(record);
    localStorage.setItem('reject_pkg_hist', JSON.stringify(hist));

    if (typeof mqttClient !== 'undefined' && mqttClient.connected) {
      mqttClient.publish('oee/reject/data', JSON.stringify(record), { retain: false });
      mqttClient.publish('oee/reject/total', String(totalSubmittedReject), { retain: true });
    }

    REJECT_TYPES.forEach(r => { rVal[r.key] = 0; });

    renderHistory();
    updateDisplay();
    showToast(
      savedToDb ? '\u2713 Tersimpan ke DB!' : '\u2713 Tersimpan (lokal saja)',
      savedToDb ? '#4ade80' : '#fb923c'
    );
  };

  function doResetLocal() {
    REJECT_TYPES.forEach(r => { rVal[r.key] = 0; });
    mState.m1 = { inputOne: 0, inputZero: 0, target: 0, runtime: 0 };
    mState.m2 = { inputOne: 0, inputZero: 0, target: 0, runtime: 0 };
    totalSubmittedReject    = 0;
    hasSubmittedThisSession = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
    if (typeof mqttClient !== 'undefined' && mqttClient.connected) {
      mqttClient.publish('oee/reject/total', '0', { retain: true });
    }
    updateDisplay();
    console.log('[Reject] Reset lokal — data DB tidak terhapus');
  }

  window.resetReject = function () {
    if (!confirm('Reset SEMUA data di halaman ini?\n\n' +
      '\u2022 Semua input reject \u2192 0\n' +
      '\u2022 Data yang sudah tersimpan di DB tidak terhapus')) return;
    doResetLocal();
    showToast('\u2713 Semua nilai direset ke 0', '#f87171');
  };

  let npTarget = '', npBuffer = '';
  const numpadModal   = el('numpadModal');
  const numpadDisplay = el('numpadDisplay');
  const numpadTitleEl = el('numpad-title');

  window.openNumpad     = function (key) { npTarget = key; npBuffer = rVal[key] > 0 ? String(rVal[key]) : ''; if (numpadTitleEl) numpadTitleEl.innerText = key.toUpperCase(); if (numpadDisplay) numpadDisplay.innerText = npBuffer || '0'; if (numpadModal) numpadModal.classList.add('active'); };
  window.closeNumpad    = function () { if (numpadModal) numpadModal.classList.remove('active'); npTarget = ''; npBuffer = ''; };
  window.numpadOutsideClick = function (e) { if (e.target === numpadModal) closeNumpad(); };
  window.numpadPress    = function (digit) { if (npBuffer.length >= 6) return; npBuffer += digit; if (numpadDisplay) numpadDisplay.innerText = npBuffer || '0'; };
  window.numpadDel      = function () { npBuffer = npBuffer.slice(0, -1); if (numpadDisplay) numpadDisplay.innerText = npBuffer || '0'; };
  window.numpadClear    = function () { npBuffer = ''; if (numpadDisplay) numpadDisplay.innerText = '0'; };
  window.numpadConfirm  = function () { if (npTarget) rVal[npTarget] = parseInt(npBuffer) || 0; closeNumpad(); updateDisplay(); };

  document.addEventListener('keydown', e => {
    if (!numpadModal?.classList.contains('active')) return;
    if (e.key >= '0' && e.key <= '9') numpadPress(e.key);
    else if (e.key === 'Backspace') numpadDel();
    else if (e.key === 'Enter')     numpadConfirm();
    else if (e.key === 'Escape')    closeNumpad();
    else if (e.key === 'Delete')    numpadClear();
  });

  const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

  mqttClient.on('connect', () => {
    console.log('[Reject] MQTT Connected');
    setMqttStatus('Connected', '#4ade80');
    [
      'oee/machine1/count',     'oee/machine2/count',
      'oee/machine1/target',    'oee/machine2/target',
      'oee/machine1/runtime',   'oee/machine2/runtime',
      'oee/machine1/reset',     'oee/machine2/reset',
      'oee/machine1/setup-info',
      'oee/reject/total',
    ].forEach(t => mqttClient.subscribe(t));
  });

  mqttClient.on('error',     () => setMqttStatus('Error',        '#f87171'));
  mqttClient.on('reconnect', () => setMqttStatus('Reconnecting', '#fb923c'));
  mqttClient.on('offline',   () => { setMqttStatus('Offline', '#f87171'); updateDisplay(); });

  mqttClient.on('message', (topic, message) => {
    const p = message.toString().trim();

    if (topic === 'oee/machine1/setup-info') {
      try {
        const info = JSON.parse(p);
        setupInfo = {
          shift:   info.shift   || 1,
          product: info.product || '-',
          date:    info.date    || new Date().toISOString().split('T')[0],
        };
        saveState();
        console.log('[Reject] setupInfo sync dari dashboard:', setupInfo);
      } catch(e) {}
      return;
    }

    if (topic === 'oee/reject/total') {
      const val = parseInt(p) || 0;
      if (!hasSubmittedThisSession && val > totalSubmittedReject) {
        totalSubmittedReject = val;
        saveState();
        updateDisplay();
      }
      return;
    }

    if (topic === 'oee/machine1/count') { if (p === '1') mState.m1.inputOne++; else mState.m1.inputZero++; updateDisplay(); }
    if (topic === 'oee/machine2/count') { if (p === '1') mState.m2.inputOne++; else mState.m2.inputZero++; updateDisplay(); }

    if (topic === 'oee/machine1/target')  { mState.m1.target  = parseInt(p) || 0; updateDisplay(); }
    if (topic === 'oee/machine2/target')  { mState.m2.target  = parseInt(p) || 0; updateDisplay(); }
    if (topic === 'oee/machine1/runtime') { mState.m1.runtime = parseInt(p) || 0; updateDisplay(); }
    if (topic === 'oee/machine2/runtime') { mState.m2.runtime = parseInt(p) || 0; updateDisplay(); }

    if (topic === 'oee/machine1/reset') {
      if (resetFlags.m1) return;
      resetFlags.m1 = true;
      console.log(`[Reject] M1 reset. M1=${resetFlags.m1} M2=${resetFlags.m2}`);
      if (resetFlags.m1 && resetFlags.m2) {
        doResetLocal();
        resetFlags.m1 = false;
        resetFlags.m2 = false;
        showToast('\u21ba Kedua mesin reset', '#fb923c');
      }
    }
    if (topic === 'oee/machine2/reset') {
      if (resetFlags.m2) return;
      resetFlags.m2 = true;
      console.log(`[Reject] M2 reset. M1=${resetFlags.m1} M2=${resetFlags.m2}`);
      if (resetFlags.m1 && resetFlags.m2) {
        doResetLocal();
        resetFlags.m1 = false;
        resetFlags.m2 = false;
        showToast('\u21ba Kedua mesin reset', '#fb923c');
      }
    }
  });

  function setMqttStatus(text, color) {
    const s = el('mqtt-status');
    if (s) { s.innerText = text; s.style.color = color; }
  }

  function showToast(msg = 'Berhasil', color = '#4ade80') {
    const t = el('toast');
    if (!t) return;
    t.innerText = msg; t.style.color = color;
    t.style.borderColor = color + '4d';
    t.style.boxShadow   = `0 0 24px ${color}1a`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  setInterval(saveState, 10000);

  initChart();
  renderHistory();
  updateDisplay();

  console.log('✅ Reject.packaging.js loaded');
  console.log('   DB payload: tgl/shift/produk/target dari setupInfo + detail reject per jenis');
  console.log('   setupInfo sync otomatis dari oee/machine1/setup-info (retained)');
  console.log('   Dual reset (M1+M2) → reset lokal, DB tidak terhapus');
});