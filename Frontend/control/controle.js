document.addEventListener('DOMContentLoaded', () => {

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

  const MS_PER_PCS      = 2069;
  const POPUP_LIMIT     = 3  * 60 * 1000;
  const BREAKDOWN_LIMIT = 10 * 60 * 1000;
  const API_BASE        = `http://${window.location.hostname}:3000/api`;
  const MACHINE_NUM     = 1;

  const BREAKDOWN_INDIVIDUAL = ['Seal', 'Coding', 'Vakum Bag', 'Capit', 'Weighting', 'Nirogen', 'MD'];
  const BREAKDOWN_SHARED     = ['Kompresor', 'Elevator', 'Roaster', 'DLL'];
  
  let inputOne = 0, inputZero = 0, totalTarget = 0, setupTime = 0, runtime = 0;
  let minorBreakdownAcc = 0, downtimeAcc = 0;
  let minorBreakdownWatch = 0, watchStart = null, inDowntime = false;
  let liveTimer = null, popupOpen = false, popupSubmitted = false, committedDowntime = 0;
  let sensorEnabled = false;
  let dtLog = [];

  let setupInfoLocal = {
    shift:   1,
    product: '-',
    date:    new Date().toISOString().split('T')[0],
  };

  const STORAGE_KEY = 'oee_mesin1_state';

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        inputOne, inputZero, totalTarget, setupTime, runtime,
        minorBreakdownAcc, downtimeAcc,
        minorBreakdownWatch: minorBreakdownWatch + (watchStart !== null ? Date.now() - watchStart : 0),
        dtLog, sensorEnabled, savedAt: Date.now(),
      }));
    } catch(e) {}
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
    } catch(e) { console.warn('[Mesin1] Gagal load state:', e); }
  }

  function clearState() { try { localStorage.removeItem(STORAGE_KEY); } catch(e) {} }
  
                          ;(function cleanLegacyDbKey() {
    ['oee_mesin1_session_id'].forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  })();

  const todayEl = document.getElementById('today');
  if (todayEl) todayEl.innerText = new Date().toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const productionDate = document.getElementById('productionDate');
  if (productionDate) {
    const n = new Date();
    productionDate.value = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  }

  let numpadValue = '';
  if (targetInput && numpadModal && numpadDisplay) {
    targetInput.addEventListener('click', () => { numpadValue = targetInput.value ? String(parseInt(targetInput.value)) : ''; numpadDisplay.innerText = numpadValue || '0'; numpadModal.classList.remove('hidden'); });
    numpadModal.addEventListener('click', e => { if (e.target === numpadModal) numpadModal.classList.add('hidden'); });
  }
  document.querySelectorAll('.numBtn').forEach(btn => { btn.addEventListener('click', () => { if (numpadValue.length < 6) { numpadValue += btn.innerText; numpadDisplay.innerText = numpadValue; } }); });
  document.getElementById('btnClear')?.addEventListener('click',  () => { numpadValue = ''; numpadDisplay.innerText = '0'; });
  document.getElementById('btnDelete')?.addEventListener('click', () => { numpadValue = numpadValue.slice(0, -1); numpadDisplay.innerText = numpadValue || '0'; });
  document.getElementById('btnOk')?.addEventListener('click', () => { if (numpadValue !== '') { const val = parseInt(numpadValue); if (targetInput) targetInput.value = val; totalTarget = val; updateDisplay(); } numpadModal?.classList.add('hidden'); });

  function updateRelayBadge(isOn) {
    if (!relayBadge) return;
    relayBadge.innerText = isOn ? '● SENSOR ON' : '● SENSOR OFF';
    relayBadge.className = 'px-4 py-1.5 rounded-full text-sm font-mono font-semibold tracking-widest ' +
      (isOn ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30') +
      ' transition-all duration-300';
    if (sensorStatus) sensorStatus.innerText = isOn ? 'ON' : 'OFF';
  }

  function handleSensorOn()  { sensorEnabled = true;  updateRelayBadge(true);  showToast('● Sensor ON — Tracking aktif', '#4ade80'); }
  function handleSensorOff() {
    sensorEnabled = false; updateRelayBadge(false); freezeAllTracking();
    showToast('■ Sensor OFF — Tracking dihentikan', '#f87171');
  }

  function freezeAllTracking() {
    clearInterval(liveTimer); liveTimer = null;
    if (watchStart !== null) { minorBreakdownWatch += Date.now() - watchStart; watchStart = null; }
    if (minorBreakdownWatch > 0) {
      if (inDowntime) downtimeAcc += minorBreakdownWatch;
      else minorBreakdownAcc += minorBreakdownWatch;
      minorBreakdownWatch = 0;
    }
    inDowntime = false; committedDowntime = 0; popupSubmitted = false;
    if (popupOpen) closePopup();
    if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc);
    if (downtimeEl)       downtimeEl.innerText       = formatTime(downtimeAcc);
    updateDisplay();
  }

  document.getElementById('dt-submit-btn')?.addEventListener('click', () => submitDowntime(true));

  function fmtMM(ms) { const s = Math.max(0, Math.floor((ms||0)/1000)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
  function formatTime(ms) { const s=Math.floor((ms||0)/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60; return [h,m,sc].map(v=>String(v).padStart(2,'0')).join(':'); }
  function formatEstimasi(ms) { const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60; if(h>0)return`${h}j ${m}m ${sc}d`;if(m>0)return`${m}m ${sc}d`;return`${sc}d`; }

  function getWatchElapsed() { if (watchStart===null) return minorBreakdownWatch; return minorBreakdownWatch+(Date.now()-watchStart); }

  function upgradePopupToBreakdown() {
    inDowntime = true;
    const head=document.getElementById('popup-dt-head'),icon=document.getElementById('popup-dt-icon'),
          tag=document.getElementById('popup-dt-tag'),sub=document.getElementById('popup-dt-sub'),
          label=document.getElementById('popup-dt-label'),btn=document.getElementById('dt-submit-btn'),
          reasonWrap=document.getElementById('dt-reason-wrap');
    head.style.background='rgba(248,113,113,.07)'; tag.style.color='#f87171';
    icon.innerText='🔴'; tag.innerText='Breakdown — Mesin 1';
    sub.innerText='Mesin berhenti ≥ 10 menit — pilih alasan breakdown';
    label.innerText='Alasan Breakdown'; btn.className='dt-btn dt-btn-breakdown';
    reasonWrap.innerHTML=`<select id="dt-reason" style="width:100%;padding:11px 14px;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#e2ddd5;font-family:'DM Mono',monospace;font-size:16px;outline:none;appearance:none;cursor:pointer;">
      <option value="" style="background:#0d1117">— Pilih alasan —</option>
      <optgroup label="Per Mesin">${BREAKDOWN_INDIVIDUAL.map(r=>`<option value="${r}" style="background:#0d1117">${r}</option>`).join('')}</optgroup>
      <optgroup label="Shared (ambil durasi terlama)">${BREAKDOWN_SHARED.map(r=>`<option value="SHARED:${r}" style="background:#0d1117">${r} ⚡</option>`).join('')}</optgroup>
    </select>`;
    if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc);
    try { mqttClient.publish('oee/machine1/downtime-start', '1'); } catch(e) {}
    disableSubmitBtn();
  }

  function onZeroDetected() {
    if (!sensorEnabled || watchStart !== null) return;
    watchStart = Date.now();
    clearInterval(liveTimer);
    liveTimer = setInterval(() => {
      if (!sensorEnabled) { clearInterval(liveTimer); liveTimer = null; return; }
      const total = getWatchElapsed();
      if (popupOpen && !inDowntime && total >= BREAKDOWN_LIMIT) upgradePopupToBreakdown();
      if (!inDowntime) {
        if (total < POPUP_LIMIT) { if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc+total); }
        else if (!popupOpen)     { if (minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc); openPopup(total); disableSubmitBtn(); }
      }
      if (popupOpen) { const d=document.getElementById('popup-dt-dur'); if(d) d.innerText=fmtMM(total); }
      if (inDowntime) { if (downtimeEl) downtimeEl.innerText = formatTime(downtimeAcc+total); }
    }, 500);
  }

  function onOneDetected() {
    if (!sensorEnabled) return;
    if (watchStart !== null) { minorBreakdownWatch += Date.now()-watchStart; watchStart=null; }
    clearInterval(liveTimer); liveTimer=null;
    if (popupOpen) { enableSubmitBtn(); return; }
    if (!inDowntime) {
      minorBreakdownAcc += minorBreakdownWatch; minorBreakdownWatch=0;
      try { mqttClient.publish('oee/machine1/minor', JSON.stringify({minor_total:minorBreakdownAcc}), {retain:false}); } catch(e) {}
    } else {
      if (!popupSubmitted && minorBreakdownWatch > 0) {
        committedDowntime=minorBreakdownWatch; downtimeAcc+=minorBreakdownWatch; minorBreakdownWatch=0; inDowntime=false;
        try { mqttClient.publish('oee/machine1/downtime', JSON.stringify({alasan:'auto-commit',durasi_ms:committedDowntime,downtime_total:downtimeAcc,minor_total:minorBreakdownAcc}),{retain:false}); } catch(e) {}
      }
    }
    popupSubmitted=false; updateDisplay();
  }

  function openPopup(elapsed) {
    popupOpen=true;
    const head=document.getElementById('popup-dt-head'),icon=document.getElementById('popup-dt-icon'),
          tag=document.getElementById('popup-dt-tag'),sub=document.getElementById('popup-dt-sub'),
          label=document.getElementById('popup-dt-label'),btn=document.getElementById('dt-submit-btn');
    head.style.background='rgba(251,146,60,.07)'; tag.style.color='#fb923c';
    icon.innerText='⚠️'; tag.innerText='Minor Breakdown — Mesin 1';
    sub.innerText='Mesin berhenti 3–9 menit (masuk Minor Breakdown)';
    label.innerText='Alasan Berhenti'; btn.className='dt-btn dt-btn-minor';
    document.getElementById('dt-reason-wrap').innerHTML=`<textarea id="dt-reason" rows="2" inputmode="text" enterkeyhint="done" placeholder="Ketik alasan berhenti..." autocomplete="off" style="width:100%;padding:11px 14px;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#e2ddd5;font-family:'DM Mono',monospace;font-size:16px;outline:none;resize:none;height:72px;line-height:1.5;-webkit-user-select:text;user-select:text;touch-action:manipulation;cursor:text;"></textarea>`;
    document.getElementById('popup-dt-dur').innerText=fmtMM(elapsed);
    const overlay=document.getElementById('popup-downtime');
    overlay.style.visibility='visible'; overlay.style.opacity='1'; overlay.style.pointerEvents='auto';
    disableSubmitBtn();
    setTimeout(()=>{ const inp=document.getElementById('dt-reason'); if(inp) inp.focus(); },100);
  }

  function closePopup() {
    const overlay=document.getElementById('popup-downtime');
    if(overlay){overlay.style.visibility='hidden';overlay.style.opacity='0';overlay.style.pointerEvents='none';}
    popupOpen=false;
  }

  function enableSubmitBtn()  { const btn=document.getElementById('dt-submit-btn'); if(!btn)return; btn.disabled=false; btn.style.opacity='1'; btn.style.cursor='pointer'; btn.className=inDowntime?'dt-btn dt-btn-breakdown':'dt-btn dt-btn-minor'; btn.innerText='✓ Submit'; }
  function disableSubmitBtn() { const btn=document.getElementById('dt-submit-btn'); if(!btn)return; btn.disabled=true; btn.style.opacity='0.4'; btn.style.cursor='not-allowed'; btn.innerText='⏳ Menunggu Mesin Jalan...'; }

  async function postPopupDowntimeToDB(type, alasan, durasi_ms, isShared) {
    try {
      const body = {
        tgl_produksi:          setupInfoLocal.date    || new Date().toISOString().split('T')[0],
        shift:                 setupInfoLocal.shift   || 1,
        product:               setupInfoLocal.product || '-',
        minor_durasi_m1_ms:    0, minor_alasan_m1:    '-',
        minor_durasi_m2_ms:    0, minor_alasan_m2:    '-',
        downtime_durasi_m1_ms: 0, downtime_alasan_m1: '-',
        downtime_durasi_m2_ms: 0, downtime_alasan_m2: '-',
        is_shared:             isShared ? 1 : 0,
      };
      if (type === 'minorbreakdown') {
        body.minor_durasi_m1_ms = durasi_ms;
        body.minor_alasan_m1    = alasan;
      } else if (isShared) {
        body.downtime_durasi_m1_ms = durasi_ms;
        body.downtime_alasan_m1    = alasan;
        body.downtime_durasi_m2_ms = durasi_ms;
        body.downtime_alasan_m2    = alasan;
      } else {
        body.downtime_durasi_m1_ms = durasi_ms;
        body.downtime_alasan_m1    = alasan;
      }
      const res  = await fetch(`${API_BASE}/downtime/popup`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      const data = await res.json();
      if (data.ok) console.log(`[Downtime DB] ✅ INSERT popup id=${data.popup_id} type=${type}`);
      else         console.warn('[Downtime DB] INSERT popup gagal:', data.error);
    } catch(err) { console.warn('[Downtime DB] POST popup error:', err.message); }
  }

  async function submitDowntime(requireReason) {
    const reason = document.getElementById('dt-reason')?.value || '';
    if (requireReason && !reason) { showToast('⚠️ Ketik alasan terlebih dahulu', '#f87171'); return; }
    if (watchStart !== null) { minorBreakdownWatch += Date.now()-watchStart; watchStart=null; clearInterval(liveTimer); liveTimer=null; }
    const totalDur  = minorBreakdownWatch > 0 ? minorBreakdownWatch : committedDowntime;
    const _isShared = reason && reason.startsWith('SHARED:');
    if (minorBreakdownWatch > 0) {
      if (inDowntime) { if (_isShared) { downtimeAcc = totalDur; } else { downtimeAcc += totalDur; } }
      else { minorBreakdownAcc += totalDur; }
    }
    minorBreakdownWatch=0; committedDowntime=0; inDowntime=false; popupSubmitted=true;
    closePopup();
    const isShared   = _isShared;
    const cleanLabel = isShared ? reason.replace('SHARED:','') : (reason||'—');
    const logType    = (totalDur >= BREAKDOWN_LIMIT) ? 'downtime' : 'minorbreakdown';
    addLog(logType, cleanLabel+(isShared?' ⚡':''), '', totalDur);

    if (logType === 'downtime') {
      if (isShared) {
        try { mqttClient.publish('oee/shared-downtime', JSON.stringify({alasan:cleanLabel,durasi_ms:totalDur,dari_mesin:1}),{retain:false}); } catch(e) {}
      } else {
        try { mqttClient.publish('oee/machine1/downtime', JSON.stringify({alasan:cleanLabel,durasi_ms:totalDur,downtime_total:downtimeAcc,minor_total:minorBreakdownAcc})); } catch(e) {}
      }
    } else {
      try { mqttClient.publish('oee/machine1/minor', JSON.stringify({minor_total:minorBreakdownAcc}),{retain:false}); } catch(e) {}
    }

    await postPopupDowntimeToDB(logType, cleanLabel, totalDur, isShared);

    showToast(requireReason ? '✓ Tersimpan' : '✓ Ditutup tanpa alasan', requireReason ? '#fb923c' : '#78716c');
    updateDisplay();
  }

  function addLog(type, reason, note, durMs) {
    dtLog.unshift({no:dtLog.length+1,waktu:new Date().toLocaleTimeString('id-ID'),type,reason,dur:fmtMM(durMs||0),note:note||'—'});
    renderLog();
  }

  function renderLog() {
    const wrap=document.getElementById('dt-log-wrap');
    if(!wrap)return;
    if(!dtLog.length){wrap.classList.remove('show');return;}
    wrap.classList.add('show');
    const rows=dtLog.map((d,i)=>{
      const isDown=d.type==='downtime',color=isDown?'#f87171':'#fb923c',tagText=isDown?'DOWNTIME':'MINOR BREAKDOWN';
      return`<tr><td style="color:#44403c">${dtLog.length-i}</td><td style="color:#57534e">${d.waktu}</td><td><span style="padding:2px 8px;border-radius:5px;font-size:9px;letter-spacing:.1em;background:${color}1a;color:${color};border:1px solid ${color}40">${tagText}</span></td><td style="color:#e2ddd5">${d.reason}</td><td style="color:#4ade80">${d.dur}</td><td style="color:#57534e">${d.note}</td></tr>`;
    }).join('');
    wrap.innerHTML=`<table id="dt-log-table"><thead><tr><th>#</th><th>Waktu</th><th>Tipe</th><th>Alasan</th><th>Durasi</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function showToast(msg,color='#4ade80') {
    const t=document.getElementById('dt-toast');
    if(!t)return;
    t.innerText=msg;t.style.color=color;t.style.borderColor=color+'40';
    t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3000);
  }

  const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

  mqttClient.on('connect', () => {
    console.log('✅ MQTT Connected (Mesin 1)');
    ['oee/machine1/count','oee/machine1/setup','oee/machine1/lost','oee/machine1/runtime',
     'oee/machine1/target','oee/machine1/reset','oee/machine1/relay-status',
     'oee/machine1/setup-info','oee/shared-downtime'].forEach(t=>mqttClient.subscribe(t));
  });

  mqttClient.on('message', (topic, message) => {
    const payload = message.toString().trim();
    
    if (topic === 'oee/machine1/setup-info') {
      try {
        const info = JSON.parse(payload);
        setupInfoLocal = { shift:info.shift||1, product:info.product||'-', date:info.date||new Date().toISOString().split('T')[0] };
      } catch(e) {}
      return;
    }

    if (topic === 'oee/machine1/relay-status') { if(payload==='ON') handleSensorOn(); if(payload==='OFF') handleSensorOff(); return; }

    if (topic === 'oee/machine1/count') {
      if (!sensorEnabled) return;
      if (payload==='1') { inputOne++; if(sensorStatus) sensorStatus.innerText='ON'; onOneDetected(); }
      else               { inputZero++; if(sensorStatus) sensorStatus.innerText='OFF'; if(inputZeroEl) inputZeroEl.innerText=inputZero; onZeroDetected(); }
      updateDisplay(); return;
    }

    if (topic==='oee/machine1/setup')   { setupTime  = parseInt(payload)||0; }
    if (topic==='oee/machine1/runtime') { runtime    = parseInt(payload)||0; }
    if (topic==='oee/machine1/target')  { const val=parseInt(payload)||0; totalTarget=val; if(targetInput) targetInput.value=val>0?val:''; }
    if (topic==='oee/machine1/reset')   { doReset(); console.log('🔄 RESET received (Mesin 1)'); }

    if (topic==='oee/shared-downtime') {
      try {
        const ev=JSON.parse(payload);
        if(ev.dari_mesin!==1){
          const durasi=ev.durasi_ms||0;
          if(durasi>downtimeAcc){ downtimeAcc=durasi; addLog('downtime',ev.alasan+' ⚡ (M2: '+fmtMM(durasi)+')',null,durasi); updateDisplay(); }
        }
      } catch(e) {}
    }
    updateDisplay();
  });

  function doReset() {
    const savedTarget=totalTarget;
    inputOne=inputZero=setupTime=runtime=0;
    minorBreakdownAcc=downtimeAcc=0;
    minorBreakdownWatch=0;watchStart=null;inDowntime=false;committedDowntime=0;
    clearInterval(liveTimer);liveTimer=null;
    popupOpen=false;popupSubmitted=false;dtLog=[];closePopup();
    totalTarget=savedTarget;clearState();saveState();
    if(targetInput) targetInput.value=savedTarget>0?savedTarget:'';
    renderLog();updateDisplay();
  }

  document.getElementById('btnSensorOn')?.addEventListener('click',  () => { mqttClient.publish('oee/machine1/relay','ON');  handleSensorOn();  });
  document.getElementById('btnSensorOff')?.addEventListener('click', () => { mqttClient.publish('oee/machine1/relay','OFF'); handleSensorOff(); });

  document.getElementById('btnRestartESP')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Restart ESP32 Mesin 1?\n\n→ Koneksi MQTT putus sementara\n→ Counter di ESP32 reset\n→ Setelah restart: isi shift & produk lalu tekan Simpan Setup\n→ Sistem akan reconnect otomatis')) return;
    showToast('🔄 Mengirim sinyal restart...', '#fb923c');
    mqttClient.publish('oee/machine1/restarted', '1', {retain:true});
    mqttClient.publish('oee/machine1/restart', 'RESTART', {retain:false});
    showToast('🔄 Perintah RESTART ESP32 dikirim...', '#f87171');
    setTimeout(() => window.location.reload(), 4000);
  });

  document.getElementById('btnReset')?.addEventListener('click', () => {
    if (!confirm('⚠️ Reset data produksi Mesin 1?\n\nTarget produksi akan tetap tidak berubah.')) return;
    doReset();
    if(totalTargetEl) totalTargetEl.innerText=String(totalTarget);
    mqttClient.publish('oee/machine1/reset','RESET',{retain:false});
    updateDisplay();
  });

  document.getElementById('btnSaveSetup')?.addEventListener('click', () => {
    const target=parseInt(targetInput?.value)||0;
    const date=document.getElementById('productionDate')?.value||'';
    const shift=document.getElementById('shift')?.value||'1';
    const product=document.getElementById('productName')?.value||'';
    if (!target) { alert('⚠️ Masukkan Target Produksi terlebih dahulu!'); return; }
    totalTarget=target;
    mqttClient.publish('oee/machine1/target', String(target), {retain:true});
    mqttClient.publish('oee/machine1/setup-info', JSON.stringify({shift:parseInt(shift),product:product||'-',date}), {retain:true});
    alert(`✅ Setup tersimpan!\nTarget : ${target} pcs\nEst.   : ${formatEstimasi(target*MS_PER_PCS)}\nProduk : ${product||'-'}\nShift  : ${shift}`);
    updateDisplay();
  });

  function updateDisplay() {
    if(inputOneEl)    inputOneEl.innerText    = inputOne;
    if(inputZeroEl)   inputZeroEl.innerText   = inputZero;
    if(totalTargetEl) totalTargetEl.innerText = totalTarget;
    if(setupTimeEl)   setupTimeEl.innerText   = formatTime(setupTime);
    if(downtimeEl)    downtimeEl.innerText    = formatTime(downtimeAcc);
    if(watchStart===null && minorBreakdownEl) minorBreakdownEl.innerText = formatTime(minorBreakdownAcc+minorBreakdownWatch);
    if(runtimeEl) runtimeEl.innerText = formatTime(runtime);
    const estEl=document.getElementById('estimasiWaktu');
    if(estEl) estEl.innerText=totalTarget>0?formatEstimasi(totalTarget*MS_PER_PCS):'—';
    saveState();
  }

  loadState(); renderLog(); updateDisplay(); updateRelayBadge(sensorEnabled);
  setInterval(saveState, 10000);

  console.log('✅ controle.js loaded — DB popup downtime aktif');
});