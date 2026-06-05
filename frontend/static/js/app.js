/* ===== HOOP SYNC — APP LOGIC ===== */

// Set window.BACKEND_URL in the HTML before this script to point to the backend URL.
// Example: <script>window.BACKEND_URL = 'https://your-space.hf.space';</script>
const API_BASE = (window.BACKEND_URL || '').replace(/\/$/, '');
const WS_BASE  = API_BASE.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

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
    const uploadRes = await fetch(`${API_BASE}/upload`, { method: 'POST', body: form });
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

    const procRes = await fetch(`${API_BASE}/process/${state.fileId}?${params}`, { method: 'POST' });
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
    const res = await fetch(`${API_BASE}/status/${state.fileId}`);
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
    await fetch(`${API_BASE}/stop/${state.fileId}`, { method: 'POST' });
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
  link.href = `${API_BASE}/download/${state.fileId}`;
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
  status: 'idle',   // idle | connecting | live | error
  active: false,
  mode: 'full_tracking',
  stats: { shots: 0, baskets: 0, accuracy: 0 },
  cameras: [],        // list of available video input deviceIds
  cameraIndex: 0      // index into cameras[] currently in use
};

// ===== LIVE FEED ACTIONS =====
async function startLiveFeed() {
  liveState.status = 'connecting';
  updateLiveUI();

  try {
    // Only use a specific deviceId if we already have a validated one from a previous
    // successful session. Enumerating before getUserMedia returns empty deviceId strings
    // on all major browsers (real IDs are hidden until permission is granted), so passing
    // deviceId: { exact: "" } would throw an OverconstrainedError.
    const videoConstraints = { width: { ideal: 640 }, height: { ideal: 480 } };
    const currentId = liveState.cameras[liveState.cameraIndex];
    if (currentId) videoConstraints.deviceId = { exact: currentId };

    liveState.stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false
    });

    // Enumerate AFTER permission is granted — deviceIds are now populated
    const devices = await navigator.mediaDevices.enumerateDevices();
    liveState.cameras = devices
      .filter(d => d.kind === 'videoinput' && d.deviceId)
      .map(d => d.deviceId);

    // Sync cameraIndex to the track that is actually open
    if (liveState.cameras.length > 0) {
      const activeId = liveState.stream.getVideoTracks()[0]?.getSettings()?.deviceId;
      const idx = liveState.cameras.indexOf(activeId);
      if (idx !== -1) liveState.cameraIndex = idx;
    }

    const video = $('liveVideo');
    video.srcObject = liveState.stream;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });

    // Build WebSocket URL — derived from API_BASE / WS_BASE so it works with any host
    const thresholdsJSON = encodeURIComponent(JSON.stringify(
      Object.fromEntries(Object.entries(state.thresholds).map(([k, v]) => [k, parseFloat(v)]))
    ));
    const mode = liveState.mode;
    liveState.ws = new WebSocket(`${WS_BASE}/live/ws?mode=${mode}&thresholds=${thresholdsJSON}`);

    liveState.ws.onopen = () => {
      liveState.status = 'live';
      liveState.active = true;
      updateLiveUI();
      sendLiveFrame();
    };

    liveState.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'frame') {
        const canvas = $('liveCanvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          if (canvas.width !== img.naturalWidth)  canvas.width  = img.naturalWidth;
          if (canvas.height !== img.naturalHeight) canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
        };
        img.src = 'data:image/jpeg;base64,' + msg.data;
        liveState.stats = msg.stats;
        updateLiveStats();
        if (liveState.active) sendLiveFrame();
      } else if (msg.type === 'error') {
        showLiveError(msg.message);
        stopLiveFeed();
      }
    };

    liveState.ws.onclose = () => { if (liveState.active) stopLiveFeed(); };
    liveState.ws.onerror = () => { showLiveError('WebSocket connection failed. Make sure the backend server is running.'); stopLiveFeed(); };

  } catch (err) {
    const msg =
      err.name === 'NotAllowedError'    || err.name === 'PermissionDeniedError'
        ? 'Camera access denied. Please allow camera permissions and try again.'
      : err.name === 'NotFoundError'    || err.name === 'DevicesNotFoundError'
        ? 'No camera found. Please connect a camera and try again.'
      : err.name === 'NotReadableError' || err.name === 'TrackStartError'
        ? 'Camera is already in use by another app. Please close it and try again.'
      : err.name === 'OverconstrainedError'
        ? 'Could not open the selected camera. Click Start again to use the default camera.'
      : (err.message || 'Failed to start live feed. Check that your browser allows camera access.');
    showLiveError(msg);
    if (liveState.stream) { liveState.stream.getTracks().forEach(t => t.stop()); liveState.stream = null; }
    liveState.status = 'error';
    updateLiveUI();
  }
}

function sendLiveFrame() {
  if (!liveState.active || !liveState.ws || liveState.ws.readyState !== WebSocket.OPEN) return;
  const video = $('liveVideo');
  const offscreen = document.createElement('canvas');
  offscreen.width = 640;
  offscreen.height = 480;
  offscreen.getContext('2d').drawImage(video, 0, 0, 640, 480);
  offscreen.toBlob(blob => {
    if (liveState.active && liveState.ws && liveState.ws.readyState === WebSocket.OPEN) {
      liveState.ws.send(blob);
    }
  }, 'image/jpeg', 0.8);
}

function stopLiveFeed() {
  liveState.active = false;
  if (liveState.ws) { liveState.ws.close(); liveState.ws = null; }
  if (liveState.stream) { liveState.stream.getTracks().forEach(t => t.stop()); liveState.stream = null; }
  $('liveVideo').srcObject = null;
  liveState.status = 'idle';
  liveState.stats = { shots: 0, baskets: 0, accuracy: 0 };
  updateLiveUI();
}

async function flipCamera() {
  if (liveState.cameras.length < 2) return;
  // Advance to the next camera in the list
  liveState.cameraIndex = (liveState.cameraIndex + 1) % liveState.cameras.length;
  // Stop current stream without resetting stats or WS
  if (liveState.stream) { liveState.stream.getTracks().forEach(t => t.stop()); liveState.stream = null; }
  // Reopen with the new camera
  try {
    liveState.stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: liveState.cameras[liveState.cameraIndex] }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    const video = $('liveVideo');
    video.srcObject = liveState.stream;
    await new Promise(resolve => { video.onloadedmetadata = resolve; });
  } catch (err) {
    showLiveError('Could not switch camera: ' + (err.message || err));
  }
}

function showLiveError(msg) {
  setVisible('liveError', true);
  $('liveErrorText').textContent = msg;
  liveState.status = 'error';
}

function updateLiveStats() {
  $('liveStatShots').textContent = liveState.stats.shots ?? 0;
  $('liveStatBaskets').textContent = liveState.stats.baskets ?? 0;
  $('liveStatAccuracy').textContent = (liveState.stats.accuracy ?? 0).toFixed(1) + '%';
}

function updateLiveUI() {
  const isLive = liveState.status === 'live';
  const isConnecting = liveState.status === 'connecting';
  const isActive = isLive || isConnecting;

  setVisible('liveCanvas', isLive);
  setVisible('livePlaceholder', !isLive);
  setVisible('liveDot', isLive);
  setVisible('btnStartLive', !isActive);
  setVisible('btnStopLive', isActive);
  setVisible('liveStatsSection', isLive);
  setVisible('btnFlipCamera', isLive && liveState.cameras.length > 1);
  setEnabled('liveModeSelect', !isActive);

  if (liveState.status !== 'error') setVisible('liveError', false);

  const badgeMap = {
    idle:       { text: 'Ready',        cls: 'badge-purple' },
    connecting: { text: 'Connecting…',  cls: 'badge-orange' },
    live:       { text: 'LIVE',         cls: 'badge-live'   },
    error:      { text: 'Error',        cls: 'badge-error'  }
  };
  const bi = badgeMap[liveState.status] || badgeMap.idle;
  const badge = $('liveBadge');
  if (badge) { badge.textContent = bi.text; badge.className = 'badge ' + bi.cls; }
}
