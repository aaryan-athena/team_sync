/* ===== TEAM SYNC — APP LOGIC ===== */

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
  link.download = 'team_sync_analysis.mp4';
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
