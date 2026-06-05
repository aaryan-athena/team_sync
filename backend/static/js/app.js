/* ===== HOOP SYNC — APP LOGIC ===== */

const DEFAULT_THRESHOLDS = {
  0: 0.60, // Ball
  1: 0.25, // Ball in Basket
  2: 0.70, // Player
  3: 0.70, // Basket
  4: 0.77  // Player Shooting
};

const CLASS_NAMES = {
  0: 'Ball',
  1: 'Ball in Basket',
  2: 'Player',
  3: 'Basket',
  4: 'Player Shooting'
};

const state = {
  file: null,
  fileId: null,
  status: 'idle',        // idle | uploading | processing | completed | error | stopped
  progress: 0,
  stats: { shots: 0, baskets: 0, accuracy: 0 },
  processingMode: 'full_tracking',
  testMode: false,
  thresholds: { ...DEFAULT_THRESHOLDS },
  pollTimer: null
};

// ===== DOM REFS =====
const $ = id => document.getElementById(id);

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderThresholds();
  bindEvents();
  updateUI();
});

function bindEvents() {
  // File input
  $('fileInput').addEventListener('change', onFileSelected);

  // Upload zone click/drag
  const zone = $('uploadZone');
  zone.addEventListener('click', () => $('fileInput').click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('video/')) setFile(f);
  });

  // Buttons
  $('btnChangeFile').addEventListener('click', () => $('fileInput').click());
  $('btnStart').addEventListener('click', uploadAndProcess);
  $('btnStop').addEventListener('click', stopProcessing);
  $('btnDownload').addEventListener('click', downloadVideo);
  $('btnReset').addEventListener('click', resetApp);
  $('btnAdvanced').addEventListener('click', () => openModal());
  $('btnCloseModal').addEventListener('click', closeModal);
  $('btnResetThresholds').addEventListener('click', resetThresholds);
  $('btnSaveThresholds').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });

  // Mode selector
  $('processingMode').addEventListener('change', e => { state.processingMode = e.target.value; });

  // Test mode toggle
  $('testModeToggle').addEventListener('click', toggleTestMode);

  // Tab switching
  $('tabBtnUpload').addEventListener('click', () => switchTab('upload'));
  $('tabBtnLive').addEventListener('click', () => switchTab('live'));

  // Live feed buttons
  $('btnStartLive').addEventListener('click', startLiveFeed);
  $('btnStopLive').addEventListener('click', stopLiveFeed);
  $('btnFlipCamera').addEventListener('click', flipCamera);
  $('btnLiveAdvanced').addEventListener('click', openModal);
  $('liveModeSelect').addEventListener('change', e => { liveState.mode = e.target.value; });
  $('btnDownloadStats').addEventListener('click', downloadStats);
}

// ===== FILE HANDLING =====
function onFileSelected(e) {
  const f = e.target.files[0];
  if (f) setFile(f);
}

function setFile(f) {
  state.file = f;
  state.fileId = null;
  state.status = 'idle';
  clearPoll();
  updateUI();
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ===== CORE ACTIONS =====
async function uploadAndProcess() {
  if (!state.file) return;

  state.status = 'uploading';
  state.progress = 0;
  updateUI();

  try {
    // 1. Upload
    const form = new FormData();
    form.append('file', state.file);
    const uploadRes = await fetch('/upload', { method: 'POST', body: form });
    if (!uploadRes.ok) throw new Error('Upload failed: ' + (await uploadRes.text()));
    const uploadData = await uploadRes.json();
    state.fileId = uploadData.file_id;

    // 2. Start Processing
    state.status = 'processing';
    updateUI();

    const thresholdsJSON = JSON.stringify(Object.fromEntries(
      Object.entries(state.thresholds).map(([k, v]) => [k, parseFloat(v)])
    ));
    const params = new URLSearchParams({
      test_mode: state.testMode,
      mode: state.processingMode,
      thresholds: thresholdsJSON
    });

    const procRes = await fetch(`/process/${state.fileId}?${params}`, { method: 'POST' });
    if (!procRes.ok) throw new Error('Processing start failed');

    // 3. Poll
    startPoll();

  } catch (err) {
    state.status = 'error';
    state.errorMsg = err.message;
    updateUI();
  }
}

async function checkStatus() {
  if (!state.fileId) return;
  try {
    const res = await fetch(`/status/${state.fileId}`);
    const data = await res.json();

    if (data.status === 'processing') {
      state.progress = data.percentage || 0;
      if (data.stats) state.stats = data.stats;
    } else if (data.status === 'completed') {
      state.status = 'completed';
      state.progress = 100;
      if (data.stats) state.stats = data.stats;
      clearPoll();
    } else if (data.status === 'stopped') {
      state.status = 'stopped';
      if (data.stats) state.stats = data.stats;
      clearPoll();
    } else if (data.status === 'error') {
      state.status = 'error';
      state.errorMsg = data.message || 'Unknown error';
      clearPoll();
    }
    updateUI();
  } catch (e) {
    console.warn('Status poll error:', e);
  }
}

async function stopProcessing() {
  if (!state.fileId) return;
  try {
    await fetch(`/stop/${state.fileId}`, { method: 'POST' });
    state.status = 'stopped';
    clearPoll();
    updateUI();
  } catch (e) {
    console.error(e);
  }
}

function downloadVideo() {
  if (!state.fileId) return;
  const link = document.createElement('a');
  link.href = `/download/${state.fileId}`;
  link.download = 'hoop_sync_analysis.mp4';
  link.click();
}

function resetApp() {
  clearPoll();
  state.file = null;
  state.fileId = null;
  state.status = 'idle';
  state.progress = 0;
  state.stats = { shots: 0, baskets: 0, accuracy: 0 };
  state.errorMsg = '';
  $('fileInput').value = '';
  updateUI();
}

// ===== POLLING =====
function startPoll() {
  clearPoll();
  state.pollTimer = setInterval(checkStatus, 1000);
}

function clearPoll() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ===== TEST MODE =====
function toggleTestMode() {
  state.testMode = !state.testMode;
  const t = $('testModeToggle');
  t.classList.toggle('on', state.testMode);
  $('testModeLabel').textContent = state.testMode ? 'Test Mode (15s)' : 'Test Mode';
}

// ===== THRESHOLDS =====
function renderThresholds() {
  const container = $('thresholdsContainer');
  container.innerHTML = '';
  Object.entries(CLASS_NAMES).forEach(([cls, name]) => {
    const val = state.thresholds[cls];
    const row = document.createElement('div');
    row.className = 'threshold-row';
    row.innerHTML = `
      <div class="threshold-header">
        <span class="threshold-name">${name}</span>
        <span class="threshold-val" id="tval-${cls}">${val.toFixed(2)}</span>
      </div>
      <input type="range" min="0.05" max="0.99" step="0.01"
        value="${val}" id="trange-${cls}"
        oninput="updateThreshold(${cls}, this.value)">
    `;
    container.appendChild(row);
  });
}

function updateThreshold(cls, val) {
  state.thresholds[cls] = parseFloat(val);
  const el = $(`tval-${cls}`);
  if (el) el.textContent = parseFloat(val).toFixed(2);
}

function resetThresholds() {
  state.thresholds = { ...DEFAULT_THRESHOLDS };
  renderThresholds();
}

// ===== MODAL =====
function openModal() {
  renderThresholds();
  $('modalOverlay').classList.add('open');
}

function closeModal() {
  $('modalOverlay').classList.remove('open');
}

// ===== UI UPDATE =====
function updateUI() {
  const s = state;

  // Upload zone vs file info
  setVisible('uploadZoneWrap', !s.file);
  setVisible('fileInfoWrap', !!s.file);

  if (s.file) {
    $('fileName').textContent = s.file.name;
    $('fileSize').textContent = formatBytes(s.file.size);
  }

  // Buttons
  const isIdle = s.status === 'idle' && !!s.file;
  const isProcessing = s.status === 'processing' || s.status === 'uploading';
  const isDone = s.status === 'completed' || s.status === 'stopped';

  setVisible('btnStart', isIdle);
  setVisible('btnStop', isProcessing);
  setVisible('btnDownload', s.status === 'completed');
  setVisible('btnReset', isDone || s.status === 'error');
  setVisible('btnChangeFile', !isProcessing);

  setEnabled('btnStart', isIdle);
  setEnabled('processingMode', !isProcessing);

  // Progress section
  setVisible('progressSection', isProcessing || isDone || s.status === 'error');

  // Status text
  const statusMap = {
    idle:       { text: 'Ready',         cls: 'text-secondary' },
    uploading:  { text: 'Uploading…',    cls: 'badge-purple' },
    processing: { text: 'Analyzing…',    cls: 'badge-purple' },
    completed:  { text: 'Complete',      cls: 'badge-green' },
    stopped:    { text: 'Stopped',       cls: 'badge-orange' },
    error:      { text: 'Error',         cls: 'badge-error' }
  };
  const si = statusMap[s.status] || statusMap.idle;
  const statusEl = $('statusBadge');
  statusEl.textContent = si.text;
  statusEl.className = 'badge ' + si.cls;

  // Progress bar
  $('progressBar').style.width = s.progress + '%';
  $('progressPct').textContent = s.progress + '%';

  // Stats
  $('statShots').textContent = s.stats.shots ?? 0;
  $('statBaskets').textContent = s.stats.baskets ?? 0;
  $('statAccuracy').textContent = (s.stats.accuracy ?? 0).toFixed(1) + '%';

  // Error
  setVisible('errorMsg', s.status === 'error');
  if (s.status === 'error') $('errorText').textContent = s.errorMsg || 'An error occurred.';

  // Uploading indicator
  setVisible('uploadingNote', s.status === 'uploading');
}

function setVisible(id, visible) {
  const el = $(id);
  if (el) el.classList.toggle('hidden', !visible);
}

function setEnabled(id, enabled) {
  const el = $(id);
  if (el) el.disabled = !enabled;
}

// ===== TAB SWITCHING =====
function switchTab(tab) {
  $('tabUpload').classList.toggle('hidden', tab !== 'upload');
  $('tabLive').classList.toggle('hidden', tab !== 'live');
  $('tabBtnUpload').classList.toggle('active', tab === 'upload');
  $('tabBtnLive').classList.toggle('active', tab === 'live');
  if (tab !== 'live' && liveState.active) stopLiveFeed();
}

// ===== LIVE FEED STATE =====
const liveState = {
  ws: null,
  stream: null,
  status: 'idle',
  active: false,
  mode: 'full_tracking',
  stats: { shots: 0, baskets: 0, accuracy: 0, persons: 0 },
  cameras: [],
  cameraIndex: 0,
  frameTimer:    null,
  pendingFrame:  false,
  rafId:         null,
  lastDetections: null,
  lastBasketAnim: null,
  lastFrameSize: { w: 640, h: 480 },
  sessionStart:  null,
  sessionData:   null
};

const DETECT_COLORS = {
  0: '#f97316', 1: '#fbbf24', 2: '#22c55e', 3: '#ef4444', 4: '#818cf8'
};

// ===== LIVE FEED ACTIONS =====
async function startLiveFeed() {
  liveState.status = 'connecting';
  updateLiveUI();

  try {
    const videoConstraints = { width: { ideal: 640 }, height: { ideal: 480 } };
    const currentId = liveState.cameras[liveState.cameraIndex];
    if (currentId) videoConstraints.deviceId = { exact: currentId };

    liveState.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });

    const devices = await navigator.mediaDevices.enumerateDevices();
    liveState.cameras = devices.filter(d => d.kind === 'videoinput' && d.deviceId).map(d => d.deviceId);
    if (liveState.cameras.length > 0) {
      const activeId = liveState.stream.getVideoTracks()[0]?.getSettings()?.deviceId;
      const idx = liveState.cameras.indexOf(activeId);
      if (idx !== -1) liveState.cameraIndex = idx;
    }

    const video = $('liveVideo');
    video.srcObject = liveState.stream;
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });

    const thresholdsJSON = encodeURIComponent(JSON.stringify(
      Object.fromEntries(Object.entries(state.thresholds).map(([k, v]) => [k, parseFloat(v)]))
    ));
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    liveState.ws = new WebSocket(`${wsProto}//${location.host}/live/ws?mode=${liveState.mode}&thresholds=${thresholdsJSON}`);

    liveState.ws.onopen = () => {
      liveState.status = 'live';
      liveState.active = true;
      liveState.pendingFrame = false;
      liveState.sessionStart = new Date();
      liveState.lastDetections = null;
      liveState.lastBasketAnim = null;
      setVisible('sessionSummary', false);
      updateLiveUI();
      // Send frames on a timer — decoupled from server response speed
      liveState.frameTimer = setInterval(() => {
        if (!liveState.pendingFrame) { liveState.pendingFrame = true; sendLiveFrame(); }
      }, 200);
      renderLiveCanvas();
    };

    liveState.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'detections') {
        liveState.pendingFrame  = false;
        liveState.lastDetections  = msg.detections;
        liveState.lastBasketAnim  = msg.basket_anim;
        liveState.lastFrameSize   = { w: msg.frame_w, h: msg.frame_h };
        liveState.stats = msg.stats;
        updateLiveStats();
      } else if (msg.type === 'error') {
        showLiveError(msg.message); stopLiveFeed();
      }
    };

    liveState.ws.onclose = () => { if (liveState.active) stopLiveFeed(); };
    liveState.ws.onerror = () => { showLiveError('WebSocket connection failed. Make sure the backend server is running.'); stopLiveFeed(); };

  } catch (err) {
    const msg =
      (err.name === 'NotAllowedError'    || err.name === 'PermissionDeniedError')
        ? 'Camera access denied. Please allow camera permissions and try again.'
      : (err.name === 'NotFoundError'    || err.name === 'DevicesNotFoundError')
        ? 'No camera found. Please connect a camera and try again.'
      : (err.name === 'NotReadableError' || err.name === 'TrackStartError')
        ? 'Camera is in use by another app. Please close it and try again.'
      : err.name === 'OverconstrainedError'
        ? 'Could not open the selected camera. Click Start again.'
      : (err.message || 'Failed to start live feed. Check camera permissions.');
    showLiveError(msg);
    if (liveState.stream) { liveState.stream.getTracks().forEach(t => t.stop()); liveState.stream = null; }
    liveState.status = 'error';
    updateLiveUI();
  }
}

function sendLiveFrame() {
  if (!liveState.active || !liveState.ws || liveState.ws.readyState !== WebSocket.OPEN) {
    liveState.pendingFrame = false; return;
  }
  const offscreen = document.createElement('canvas');
  offscreen.width = 640; offscreen.height = 480;
  offscreen.getContext('2d').drawImage($('liveVideo'), 0, 0, 640, 480);
  offscreen.toBlob(blob => {
    if (liveState.active && liveState.ws && liveState.ws.readyState === WebSocket.OPEN)
      liveState.ws.send(blob);
    else liveState.pendingFrame = false;
  }, 'image/jpeg', 0.8);
}

// ===== CLIENT-SIDE RENDERING (requestAnimationFrame loop) =====
function renderLiveCanvas() {
  if (!liveState.active) return;
  const canvas = $('liveCanvas');
  const ctx    = canvas.getContext('2d');
  const video  = $('liveVideo');
  const vw = video.videoWidth  || 640;
  const vh = video.videoHeight || 480;
  if (canvas.width !== vw)  canvas.width  = vw;
  if (canvas.height !== vh) canvas.height = vh;

  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, vw, vh);

  const fw = liveState.lastFrameSize.w || vw;
  const fh = liveState.lastFrameSize.h || vh;
  const sx = vw / fw, sy = vh / fh;

  if (liveState.mode === 'full_tracking' && liveState.lastDetections)
    drawDetections(ctx, liveState.lastDetections, sx, sy);
  if (liveState.mode !== 'stats_only' && liveState.lastBasketAnim)
    drawBasketAnim(ctx, liveState.lastBasketAnim, sx, sy);
  drawHUD(ctx, liveState.stats || {}, vw, vh);

  liveState.rafId = requestAnimationFrame(renderLiveCanvas);
}

function drawDetections(ctx, detections, sx, sy) {
  if (!detections || !detections.length) return;
  ctx.save();
  for (const d of detections) {
    const [x1, y1, x2, y2] = d.box;
    const color = DETECT_COLORS[d.cls] || '#fff';
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.strokeRect(x1*sx, y1*sy, (x2-x1)*sx, (y2-y1)*sy);
    ctx.fillStyle = color; ctx.font = '12px monospace';
    ctx.fillText(`${d.label} ${d.conf.toFixed(2)}`, x1*sx, y1*sy > 16 ? y1*sy - 4 : y1*sy + 14);
  }
  ctx.restore();
}

function drawBasketAnim(ctx, anim, sx, sy) {
  if (!anim || anim.progress <= 0) return;
  const cx = anim.cx * sx, cy = anim.cy * sy, p = anim.progress;
  let alpha = p < 0.15 ? p/0.15 : p > 0.85 ? (1-p)/0.15 : 1;
  ctx.save(); ctx.globalAlpha = alpha * 0.7;
  for (let i = 0; i < 4; i++) {
    const lp = Math.max(0, Math.min(1, (p - i*0.1) / (1 - i*0.1)));
    if (lp > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, 20 + lp*100, 0, Math.PI*2);
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = Math.max(2, 8*(1-lp)); ctx.stroke();
    }
  }
  ctx.beginPath(); ctx.arc(cx, cy, 15*(1+Math.sin(p*Math.PI*4)*0.3), 0, Math.PI*2);
  ctx.fillStyle = '#00ffff'; ctx.fill();
  ctx.restore();
}

function drawHUD(ctx, stats, w, h) {
  const pH = 90, pW = Math.min(620, w - 30), x = 15, y = h - pH - 15;
  ctx.save();
  ctx.globalAlpha = 0.88; ctx.fillStyle = 'rgba(14,14,22,0.92)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, pW, pH, 8); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x, y, pW, pH, 8); }
  else { ctx.fillRect(x, y, pW, pH); ctx.beginPath(); ctx.rect(x, y, pW, pH); }
  ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,200,255,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();

  const cw = pW / 3;
  function col(ox, label, val, color) {
    ctx.fillStyle = 'rgba(150,148,184,1)'; ctx.font = '11px sans-serif'; ctx.fillText(label, x+ox, y+26);
    ctx.fillStyle = color; ctx.font = 'bold 30px sans-serif'; ctx.fillText(String(val), x+ox, y+66);
  }
  col(20,       'SHOTS',    stats.shots   || 0, '#ffffff');
  col(cw+20,    'BASKETS',  stats.baskets || 0, '#4ade80');
  ctx.fillStyle='rgba(150,148,184,1)'; ctx.font='11px sans-serif'; ctx.fillText('ACCURACY', x+2*cw+20, y+26);
  ctx.fillStyle='#22d3ee'; ctx.font='bold 24px sans-serif'; ctx.fillText(`${(stats.accuracy||0).toFixed(1)}%`, x+2*cw+20, y+64);
  const bx=x+2*cw+20, by=y+74, bw=cw-40;
  ctx.fillStyle='rgba(50,50,50,0.8)'; ctx.fillRect(bx, by, bw, 6);
  const fw=((stats.accuracy||0)/100)*bw; if(fw>0){ctx.fillStyle='#22d3ee'; ctx.fillRect(bx, by, fw, 6);}
  ctx.restore();
}

function stopLiveFeed() {
  const wasActive = liveState.active;
  liveState.active = false;
  if (liveState.frameTimer) { clearInterval(liveState.frameTimer); liveState.frameTimer = null; }
  if (liveState.rafId)      { cancelAnimationFrame(liveState.rafId); liveState.rafId = null; }
  if (liveState.ws)         { liveState.ws.close(); liveState.ws = null; }
  if (liveState.stream)     { liveState.stream.getTracks().forEach(t => t.stop()); liveState.stream = null; }
  $('liveVideo').srcObject = null;

  if (wasActive && liveState.sessionStart) {
    const dur = Math.round((new Date() - liveState.sessionStart) / 1000);
    liveState.sessionData = {
      date: liveState.sessionStart.toLocaleDateString(),
      time: liveState.sessionStart.toLocaleTimeString(),
      duration_seconds: dur,
      shots:    liveState.stats?.shots    || 0,
      baskets:  liveState.stats?.baskets  || 0,
      accuracy: liveState.stats?.accuracy || 0,
      persons:  liveState.stats?.persons  || 0,
      mode:     liveState.mode
    };
    showSessionSummary(liveState.sessionData);
  }

  liveState.status = 'idle';
  liveState.stats  = { shots: 0, baskets: 0, accuracy: 0, persons: 0 };
  updateLiveUI();
}

async function flipCamera() {
  if (liveState.cameras.length < 2) return;
  liveState.cameraIndex = (liveState.cameraIndex + 1) % liveState.cameras.length;
  if (liveState.stream) { liveState.stream.getTracks().forEach(t => t.stop()); liveState.stream = null; }
  try {
    liveState.stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: liveState.cameras[liveState.cameraIndex] }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    const video = $('liveVideo');
    video.srcObject = liveState.stream;
    await new Promise(resolve => { video.onloadedmetadata = resolve; });
  } catch (err) { showLiveError('Could not switch camera: ' + (err.message || err)); }
}

function showLiveError(msg) {
  setVisible('liveError', true); $('liveErrorText').textContent = msg; liveState.status = 'error';
}

function updateLiveStats() {
  $('liveStatShots').textContent    = liveState.stats.shots   ?? 0;
  $('liveStatBaskets').textContent  = liveState.stats.baskets ?? 0;
  $('liveStatAccuracy').textContent = (liveState.stats.accuracy ?? 0).toFixed(1) + '%';
}

function updateLiveUI() {
  const isLive = liveState.status === 'live', isConnecting = liveState.status === 'connecting';
  const isActive = isLive || isConnecting;
  setVisible('liveCanvas',      isLive);
  setVisible('livePlaceholder', !isLive);
  setVisible('liveDot',         isLive);
  setVisible('btnStartLive',    !isActive);
  setVisible('btnStopLive',     isActive);
  setVisible('liveStatsSection', isLive);
  setVisible('btnFlipCamera',   isLive && liveState.cameras.length > 1);
  setEnabled('liveModeSelect',  !isActive);
  if (liveState.status !== 'error') setVisible('liveError', false);
  const badgeMap = {
    idle: {text:'Ready', cls:'badge-purple'}, connecting: {text:'Connecting…', cls:'badge-orange'},
    live: {text:'LIVE',  cls:'badge-live'},   error:       {text:'Error',       cls:'badge-error'}
  };
  const bi = badgeMap[liveState.status] || badgeMap.idle;
  const badge = $('liveBadge');
  if (badge) { badge.textContent = bi.text; badge.className = 'badge ' + bi.cls; }
}

// ===== SESSION SUMMARY =====
function showSessionSummary(d) {
  const m = Math.floor(d.duration_seconds / 60), s = d.duration_seconds % 60;
  $('sumDate').textContent     = d.date;
  $('sumTime').textContent     = d.time;
  $('sumDuration').textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
  $('sumShots').textContent    = d.shots;
  $('sumBaskets').textContent  = d.baskets;
  $('sumAccuracy').textContent = (d.accuracy || 0).toFixed(1) + '%';
  $('sumPersons').textContent  = d.persons;
  setVisible('sessionSummary', true);
}

function downloadStats() {
  if (!liveState.sessionData) return;
  const d = liveState.sessionData;
  const json = JSON.stringify({
    session_date: d.date, session_time: d.time, duration_seconds: d.duration_seconds,
    detection_mode: d.mode, shots_attempted: d.shots, baskets_made: d.baskets,
    accuracy_percent: parseFloat((d.accuracy||0).toFixed(1)),
    total_player_detections: d.persons
  }, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `hoop_sync_${d.date.replace(/\//g,'-')}_${d.time.replace(/:/g,'-').replace(/\s/g,'_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
