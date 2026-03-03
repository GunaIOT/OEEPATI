document.addEventListener('DOMContentLoaded', () => {
  const MS_PER_PCS = 2222;

  const REJECT_TYPES = [
    { key: 'Kosong',             elId: 'Kosong',            color: '#f87171' },
    { key: 'Coding',             elId: 'Coding',            color: '#fb923c' },
    { key: 'Seal',               elId: 'Seal',              color: '#fbbf24' },
    { key: 'Kurang Angin',       elId: 'KurangAngin',       color: '#a78bfa' },
    { key: 'Gramasi Unstandart', elId: 'GramasiUnstandart', color: '#60a5fa' },
    { key: 'Lain-lain',          elId: 'Lainlain',          color: '#4ade80' },
  ];

  // State mesin dari MQTT
  const mState = {
    m1: { inputOne: 0, inputZero: 0, target: 0, runtime: 0 },
    m2: { inputOne: 0, inputZero: 0, target: 0, runtime: 0 },
  };

  // Input reject per jenis — selalu mulai dari 0, reset setelah submit
  const rVal = {};
  REJECT_TYPES.forEach(r => (rVal[r.key] = 0));

  // Total reject yang sudah di-submit ke dashboard (sinkron via MQTT oee/reject/total)
  // Ini digunakan agar disp-good sinkron dengan nilai di dashboard
  let totalSubmittedReject = 0;

  // Riwayat submit
  let hist = JSON.parse(localStorage.getItem('reject_pkg_hist') || '[]');

  // Numpad state
  let npTarget = '';
  let npBuffer = '';

  const el = id => document.getElementById(id);
  const setText = (id, val) => { const e = el(id); if (e) e.innerText = val; };

  // ══ KALKULASI ════════════════════════════════════════════
  function derived() {
    const totalProd   = (mState.m1.inputOne + mState.m1.inputZero)
                      + (mState.m2.inputOne + mState.m2.inputZero);
    const totalGood1  = mState.m1.inputOne + mState.m2.inputOne;
    const totalTarget = mState.m1.target + mState.m2.target;

    // Reject di form sekarang (belum disubmit)
    const rejectForm = REJECT_TYPES.reduce((s, r) => s + (rVal[r.key] || 0), 0);

    // Total reject yang ditampilkan = sudah disubmit + form sekarang
    const totalReject = totalSubmittedReject + rejectForm;

    // Net good = Good(1) - semua reject (sudah submit + form sekarang)
    const netGood    = Math.max(0, totalGood1 - totalReject);
    const goodBersih = netGood;

    // QR = Good(1) / Produksi x 100
    const qr = totalProd > 0
      ? Math.min((totalGood1 / totalProd) * 100, 100).toFixed(2)
      : '0.00';

    // PR = (netGood x 2.222s) / Runtime_detik x 100
    const actualRuntimeMs = Math.max(mState.m1.runtime || 0, mState.m2.runtime || 0);
    const runtimeSec = actualRuntimeMs / 1000;
    const pr = runtimeSec > 0
      ? Math.min(((netGood * (MS_PER_PCS / 1000)) / runtimeSec) * 100, 100).toFixed(2)
      : '0.00';

    return { totalProd, totalGood1, totalTarget, totalReject, rejectForm, netGood, goodBersih, qr, pr };
  }

  // ══ UPDATE TAMPILAN ═══════════════════════════════════════
  function updateDisplay() {
    const d = derived();

    // Stat cards atas
    setText('disp-produksi', d.totalProd);
    setText('disp-target',   d.totalTarget);
    setText('disp-good',     d.netGood);      // Real-time: Good(1) - totalReject
    setText('disp-reject',   d.totalReject);  // Real-time: total semua rVal

    // Summary strip bawah reject list
    setText('sum-reject',   d.totalReject);
    setText('sum-good-net', d.netGood);

    // Nilai per baris reject
    REJECT_TYPES.forEach(r => {
      const e = el('rv-' + r.elId);
      if (e) e.innerText = rVal[r.key] || 0;
    });

    // Breakdown bars & chart
    renderBreakdown(d.totalReject);
    updateChart();
  }

  // ── Breakdown progress bars ───────────────────────────────
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

  // ── Chart ─────────────────────────────────────────────────
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
          y: { ticks: { color:'#57534e', font:{ family:'DM Mono' } }, grid: { color:'rgba(255,255,255,0.04)' }, beginAtZero: true }
        }
      }
    });
  }

  function updateChart() {
    if (!barChart) return;
    barChart.data.datasets[0].data = REJECT_TYPES.map(r => rVal[r.key] || 0);
    barChart.update();
  }

  // ══ RIWAYAT ═══════════════════════════════════════════════
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
      'Kosong': '#f87171', 'Coding': '#fb923c', 'Seal': '#fbbf24',
      'Kurang Angin': '#a78bfa', 'Gramasi Unstandart': '#60a5fa', 'Lain-lain': '#4ade80'
    };

    tbody.innerHTML = hist.map((rec, i) => {
      const realIdx = hist.length - 1 - i;
      const rowNum  = hist.length - i;
      const detailId = `detail-row-${realIdx}`;

      // Buat breakdown detail per jenis reject
      const detailHtml = rec.detail
        ? Object.entries(rec.detail)
            .filter(([k, v]) => v > 0)
            .map(([k, v]) => {
              const pct = rec.totalReject > 0 ? ((v / rec.totalReject) * 100).toFixed(0) : 0;
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

      const hasDetail = rec.detail && Object.values(rec.detail).some(v => v > 0);

      return `
      <tr id="row-${realIdx}" style="transition:background .15s"
          onmouseover="this.style.background='rgba(255,255,255,.02)'"
          onmouseout="this.style.background=''">
        <td style="${tdBase}color:#57534e">${rowNum}</td>
        <td style="${tdBase}color:#57534e;font-size:10px;white-space:nowrap">${rec.time}</td>
        <td style="${tdBase}color:#4ade80">${rec.totalProd}</td>
        <td style="${tdBase}color:#4ade80">${rec.totalGood1}</td>
        <td style="${tdBase}">
          <span style="display:inline-flex;align-items:center;gap:6px">
            <span style="color:#f87171;font-family:'DM Mono',monospace">${rec.totalReject}</span>
            ${hasDetail ? `<button onclick="toggleDetail('${detailId}')"
              id="btn-${detailId}"
              style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);
                     color:#f87171;border-radius:5px;padding:1px 7px;font-family:'DM Mono',monospace;
                     font-size:9px;letter-spacing:.06em;cursor:pointer;transition:all .15s"
              onmouseover="this.style.background='rgba(248,113,113,.18)'"
              onmouseout="this.style.background='rgba(248,113,113,.08)'">▾ detail</button>` : ''}
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
                   cursor:pointer;transition:all .15s;white-space:nowrap"
            onmouseover="this.style.background='rgba(248,113,113,.18)';this.style.borderColor='rgba(248,113,113,.4)'"
            onmouseout="this.style.background='rgba(248,113,113,.08)';this.style.borderColor='rgba(248,113,113,.2)'">
            ✕ Hapus
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
              Breakdown Reject — ${rec.time}
            </div>
            ${detailHtml}
            <div style="display:flex;justify-content:flex-end;margin-top:10px;
                        font-family:'DM Mono',monospace;font-size:10px;color:#57534e;
                        border-top:1px solid rgba(255,255,255,.05);padding-top:8px">
              Total Reject: <span style="color:#f87171;margin-left:8px">${rec.totalReject} pcs</span>
              &nbsp;|&nbsp; Net Good: <span style="color:#4ade80;margin-left:8px">${rec.goodBersih} pcs</span>
            </div>
          </div>
        </td>
      </tr>` : ''}`;
    }).join('');
  }

  // Toggle baris detail breakdown reject
  window.toggleDetail = function (detailId) {
    const row = document.getElementById(detailId);
    const btn = document.getElementById('btn-' + detailId);
    if (!row) return;
    const isHidden = row.style.display === 'none';
    row.style.display = isHidden ? 'table-row' : 'none';
    if (btn) btn.innerText = isHidden ? '▴ tutup' : '▾ detail';
  };

  window.deleteHistoryRecord = function (index) {
    if (!confirm('Hapus data riwayat ini?')) return;
    hist.splice(index, 1);
    localStorage.setItem('reject_pkg_hist', JSON.stringify(hist));
    renderHistory();
    showToast('✓ Data riwayat dihapus', '#f87171');
  };

  window.clearAllHistory = function () {
    if (!confirm('Hapus SEMUA riwayat submit?\nTindakan ini tidak bisa dibatalkan.')) return;
    hist = [];
    localStorage.removeItem('reject_pkg_hist');
    renderHistory();
    showToast('✓ Semua riwayat dihapus', '#f87171');
  };

  // ══ SUBMIT ════════════════════════════════════════════════
  window.submitReject = function () {
    const d = derived();

    if (d.totalProd === 0 && d.totalGood1 === 0) {
      alert('Belum ada data produksi dari mesin.\nPastikan mesin online & MQTT terhubung.');
      return;
    }

    // Cari jenis reject terbanyak
    let biggestReject = '-', biggestVal = 0;
    REJECT_TYPES.forEach(r => {
      if ((rVal[r.key] || 0) > biggestVal) {
        biggestVal = rVal[r.key] || 0;
        biggestReject = r.key;
      }
    });

    // Simpan snapshot data SEBELUM reset
    const record = {
      time:          new Date().toLocaleString('id-ID'),
      totalProd:     d.totalProd,
      totalGood1:    d.totalGood1,
      totalTarget:   d.totalTarget,
      totalReject:   d.totalReject,
      goodBersih:    d.goodBersih,
      netGood:       d.netGood,
      qr:            d.qr,
      pr:            d.pr,
      biggestReject: biggestVal > 0 ? `${biggestReject} (${biggestVal})` : '-',
      detail:        { ...rVal },
    };

    // Simpan ke localStorage
    hist.unshift(record);
    localStorage.setItem('reject_pkg_hist', JSON.stringify(hist));

    // Kirim ke MQTT agar dashboard update OEE
    if (typeof mqttClient !== 'undefined' && mqttClient.connected) {
      mqttClient.publish('oee/reject/data', JSON.stringify(record), { retain: false });
      console.log('📤 Reject data published');
    }

    // Akumulasi totalSubmittedReject SEBELUM reset form
    totalSubmittedReject += d.rejectForm;

    // RESET semua input form reject ke 0
    REJECT_TYPES.forEach(r => { rVal[r.key] = 0; });

    // Update riwayat dan tampilan
    // - disp-reject tetap menunjukkan totalSubmittedReject (tidak kembali ke 0)
    // - disp-good tetap berkurang sesuai total reject
    renderHistory();
    updateDisplay();

    showToast('✓ Tersimpan! Input direset ke 0', '#4ade80');
  };

  // ── Reset manual ──────────────────────────────────────────
  window.resetReject = function () {
    if (!confirm('Reset SEMUA data di halaman ini?\n\n' +
      '• Semua input reject → 0\n' +
      '• Total Produksi, Good, Target → 0\n' +
      '• Nilai akan sinkron kembali dari mesin')) return;

    // Reset semua input reject
    REJECT_TYPES.forEach(r => { rVal[r.key] = 0; });

    // Reset semua nilai mesin (Produksi, Good, Target)
    mState.m1 = { inputOne: 0, inputZero: 0, target: 0, runtime: 0 };
    mState.m2 = { inputOne: 0, inputZero: 0, target: 0, runtime: 0 };

    // Reset total reject yang sudah disubmit
    totalSubmittedReject = 0;

    updateDisplay();
    showToast('✓ Semua nilai direset ke 0', '#f87171');
  };

  // ══ NUMPAD ════════════════════════════════════════════════
  const numpadModal   = el('numpadModal');
  const numpadDisplay = el('numpadDisplay');
  const numpadTitleEl = el('numpad-title');

  window.openNumpad = function (key) {
    npTarget = key;
    npBuffer = rVal[key] > 0 ? String(rVal[key]) : '';
    if (numpadTitleEl) numpadTitleEl.innerText = key.toUpperCase();
    if (numpadDisplay) numpadDisplay.innerText = npBuffer || '0';
    if (numpadModal)   numpadModal.classList.add('active');
  };

  window.closeNumpad = function () {
    if (numpadModal) numpadModal.classList.remove('active');
    npTarget = ''; npBuffer = '';
  };

  window.numpadOutsideClick = function (e) {
    if (e.target === numpadModal) closeNumpad();
  };

  window.numpadPress = function (digit) {
    if (npBuffer.length >= 6) return;
    npBuffer += digit;
    if (numpadDisplay) numpadDisplay.innerText = npBuffer || '0';
  };

  window.numpadDel = function () {
    npBuffer = npBuffer.slice(0, -1);
    if (numpadDisplay) numpadDisplay.innerText = npBuffer || '0';
  };

  window.numpadClear = function () {
    npBuffer = '';
    if (numpadDisplay) numpadDisplay.innerText = '0';
  };

  window.numpadConfirm = function () {
    if (npTarget) {
      rVal[npTarget] = parseInt(npBuffer) || 0;
    }
    closeNumpad();
    updateDisplay(); // Langsung update semua tampilan setelah input angka
  };

  // Keyboard support saat numpad terbuka
  document.addEventListener('keydown', e => {
    if (!numpadModal?.classList.contains('active')) return;
    if (e.key >= '0' && e.key <= '9') numpadPress(e.key);
    else if (e.key === 'Backspace') numpadDel();
    else if (e.key === 'Enter')     numpadConfirm();
    else if (e.key === 'Escape')    closeNumpad();
    else if (e.key === 'Delete')    numpadClear();
  });

  // ══ MQTT ══════════════════════════════════════════════════
  const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

  mqttClient.on('connect', () => {
    console.log('MQTT Connected (Reject Packaging)');
    setMqttStatus('Connected', '#4ade80');
    [
      'oee/machine1/count',   'oee/machine2/count',
      'oee/machine1/target',  'oee/machine2/target',
      'oee/machine1/runtime', 'oee/machine2/runtime',
      'oee/machine1/reset',   'oee/machine2/reset',
    ].forEach(t => mqttClient.subscribe(t));
    mqttClient.subscribe('oee/reject/total'); // Sinkron total reject dari dashboard (retained)
  });

  mqttClient.on('error',     () => setMqttStatus('Error',        '#f87171'));
  mqttClient.on('reconnect', () => setMqttStatus('Reconnecting', '#fb923c'));
  mqttClient.on('offline',   () => {
    setMqttStatus('Offline', '#f87171');
    mState.m1 = { inputOne:0, inputZero:0, target:0, runtime:0 };
    mState.m2 = { inputOne:0, inputZero:0, target:0, runtime:0 };
    updateDisplay();
  });

  mqttClient.on('message', (topic, message) => {
    const p = message.toString().trim();

    // Sinkron total reject dari dashboard — update disp-good secara real-time
    if (topic === 'oee/reject/total') {
      totalSubmittedReject = parseInt(p) || 0;
      updateDisplay();
      return;
    }

    if (topic === 'oee/machine1/count') {
      if (p === '1') mState.m1.inputOne++; else mState.m1.inputZero++;
      updateDisplay();
    }
    if (topic === 'oee/machine2/count') {
      if (p === '1') mState.m2.inputOne++; else mState.m2.inputZero++;
      updateDisplay();
    }
    if (topic === 'oee/machine1/target')  { mState.m1.target  = parseInt(p) || 0; updateDisplay(); }
    if (topic === 'oee/machine2/target')  { mState.m2.target  = parseInt(p) || 0; updateDisplay(); }
    if (topic === 'oee/machine1/runtime') { mState.m1.runtime = parseInt(p) || 0; updateDisplay(); }
    if (topic === 'oee/machine2/runtime') { mState.m2.runtime = parseInt(p) || 0; updateDisplay(); }
    if (topic === 'oee/machine1/reset') {
      mState.m1 = { inputOne:0, inputZero:0, target:0, runtime:0 };
      REJECT_TYPES.forEach(r => { rVal[r.key] = 0; });
      totalSubmittedReject = 0; // Reset sinkron dengan dashboard
      updateDisplay();
    }
    if (topic === 'oee/machine2/reset') {
      mState.m2 = { inputOne:0, inputZero:0, target:0, runtime:0 };
      REJECT_TYPES.forEach(r => { rVal[r.key] = 0; });
      totalSubmittedReject = 0; // Reset sinkron dengan dashboard
      updateDisplay();
    }
  });

  function setMqttStatus(text, color) {
    const s = el('mqtt-status');
    if (s) { s.innerText = text; s.style.color = color; }
  }

  // ── Toast ──────────────────────────────────────────────────
  function showToast(msg = 'Berhasil', color = '#4ade80') {
    const t = el('toast');
    if (!t) return;
    t.innerText         = msg;
    t.style.color       = color;
    t.style.borderColor = color + '4d';
    t.style.boxShadow   = `0 0 24px ${color}1a`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  // ══ INIT ══════════════════════════════════════════════════
  initChart();
  renderHistory();
  updateDisplay();

  console.log('Reject.packaging.js loaded');
  console.log('Submit: simpan record -> reset rVal ke 0 -> updateDisplay()');
  console.log('disp-good   = Good(1) - totalReject  (real-time)');
  console.log('disp-reject = sum(rVal)               (real-time)');
});