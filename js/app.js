const API = '/api/get-video';
const DL_API = '/api/download';
const HOME_URL = 'https://www.xvideos.com/';

let currentHls = null;
let currentPageUrl = HOME_URL;
let currentPage = 0;
let currentLabel = 'Trending';
let cachedVideos = [];
let loadController = null;
let suggestionController = null;

let hlsLevels = [];
let currentQualityIndex = -1;
let streamSources = { hls: null, mp4high: null, mp4low: null };
let controlsTimeout = null;
let isDragging = false;
let sugDebounce = null;
let searchHistory = JSON.parse(localStorage.getItem('sx_history') || '[]');
let sugFocusIdx = -1;

async function apiFetch(url, signal) {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function loadUrl(url, page = 0, label = null) {
  if (loadController) loadController.abort();
  loadController = new AbortController();
  const signal = loadController.signal;
  currentPageUrl = url; currentPage = page;
  if (label) currentLabel = label;

  document.getElementById('home-page').style.display = 'block';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('catNav').style.display = '';
  document.getElementById('siteFooter').style.display = '';
  document.getElementById('pageLabel').textContent = currentLabel;
  document.getElementById('pagination').style.display = 'none';
  document.getElementById('searchInput').value = label && label.startsWith('🔍') ? label.slice(3).replace(/^"|"$/g,'') : '';
  showSkeletons();

  const pagedUrl = buildPagedUrl(url, page);
  try {
    const data = await apiFetch(`${API}?list=true&url=${encodeURIComponent(pagedUrl)}`, signal);
    if (!data.videos?.length) { showError('No videos found.'); return; }
    cachedVideos = data.videos;
    renderGrid(data.videos);
    document.getElementById('pagination').style.display = 'flex';
    document.getElementById('pageInfo').textContent = `Page ${page + 1}`;
    document.getElementById('prevBtn').disabled = page === 0;
  } catch (err) {
    if (err.name === 'AbortError') return;
    showError('Failed to load videos. Check your API.');
  }
}

function buildPagedUrl(base, page) {
  if (page === 0) return base;
  if (base.match(/\/new\/?$/) || base.match(/\/best\/?$/)) return base.replace(/\/?$/, '') + '/' + page;
  if (base.includes('?')) return base + '&p=' + page;
  return base + 'new/' + page;
}

function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  closeSuggestions();
  if (!q) { loadUrl(HOME_URL, 0, 'Trending'); return; }
  addToHistory(q);
  loadUrl(`https://www.xvideos.com/?k=${encodeURIComponent(q)}`, 0, `🔍 "${q}"`);
}

const searchInput = document.getElementById('searchInput');
const sugBox = document.getElementById('suggestions');

searchInput.addEventListener('input', () => {
  clearTimeout(sugDebounce);
  const q = searchInput.value.trim();
  if (!q) { showHistorySuggestions(); return; }
  sugDebounce = setTimeout(() => fetchSuggestions(q), 300);
});

searchInput.addEventListener('focus', () => {
  const q = searchInput.value.trim();
  if (!q) showHistorySuggestions();
  else fetchSuggestions(q);
});

searchInput.addEventListener('keydown', (e) => {
  const items = sugBox.querySelectorAll('.sug-item, .sug-text-item');
  if (!items.length || !sugBox.classList.contains('open')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); sugFocusIdx = Math.min(sugFocusIdx + 1, items.length - 1); updateSugFocus(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sugFocusIdx = Math.max(sugFocusIdx - 1, -1); updateSugFocus(items); }
  else if (e.key === 'Enter' && sugFocusIdx >= 0) { e.preventDefault(); items[sugFocusIdx].click(); }
  else if (e.key === 'Escape') { closeSuggestions(); }
});

function updateSugFocus(items) {
  items.forEach((it, i) => it.classList.toggle('focused', i === sugFocusIdx));
  if (sugFocusIdx >= 0 && items[sugFocusIdx]) items[sugFocusIdx].scrollIntoView({ block: 'nearest' });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) closeSuggestions();
});

function closeSuggestions() {
  if (suggestionController) suggestionController.abort();
  sugBox.classList.remove('open');
  sugFocusIdx = -1;
}

async function fetchSuggestions(q) {
  if (suggestionController) suggestionController.abort();
  suggestionController = new AbortController();
  try {
    const data = await apiFetch(`${API}?search=true&list=true&url=${encodeURIComponent('https://www.xvideos.com/?k=' + encodeURIComponent(q))}`, suggestionController.signal);
    if (!data.videos?.length) { closeSuggestions(); return; }
    renderSuggestions(data.videos.slice(0, 8), q);
  } catch (err) {
    if (err.name !== 'AbortError') closeSuggestions();
  }
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function renderSuggestions(videos, query) {
  sugFocusIdx = -1;
  let html = `<div class="sug-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>Results for "${escHtml(query)}"</div>`;
  videos.forEach(v => {
    const vj = escJson(v);
    html += `<button class="sug-item" onclick="closeSuggestions();playVideo(${vj})">
      <img class="sug-item-thumb" src="${escHtml(v.thumb)}" alt="" loading="lazy" onerror="this.style.opacity=0">
      <div class="sug-item-text"><div class="sug-item-title">${escHtml(v.title)}</div>
      <div class="sug-item-meta">${escHtml(v.duration||'')} ${v.uploader ? '· '+escHtml(v.uploader) : ''}</div></div>
      <svg class="sug-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>
    </button>`;
  });
  sugBox.innerHTML = html;
  sugBox.classList.add('open');
}

function showHistorySuggestions() {
  if (!searchHistory.length) { closeSuggestions(); return; }
  sugFocusIdx = -1;
  let html = `<div class="sug-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Recent searches</div>`;
  searchHistory.slice(0, 6).forEach(q => {
    const safeQ = JSON.stringify(q);
    html += `<button class="sug-text-item" onclick="searchInput.value=${safeQ};doSearch()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${escHtml(q)}</button>`;
  });
  html += `<div class="sug-divider"></div><button class="sug-clear" onclick="clearHistory()">Clear search history</button>`;
  sugBox.innerHTML = html;
  sugBox.classList.add('open');
}

function addToHistory(q) {
  searchHistory = searchHistory.filter(h => h.toLowerCase() !== q.toLowerCase());
  searchHistory.unshift(q);
  if (searchHistory.length > 10) searchHistory = searchHistory.slice(0, 10);
  localStorage.setItem('sx_history', JSON.stringify(searchHistory));
}

function clearHistory() {
  searchHistory = [];
  localStorage.removeItem('sx_history');
  closeSuggestions();
}

function selectCategory(el) {
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  loadUrl(el.dataset.url, 0, el.dataset.label);
}

function selectCategoryByLabel(label) {
  const chip = document.querySelector(`.cat-chip[data-label="${label}"]`);
  if (chip) selectCategory(chip);
}

function renderGrid(videos) {
  document.getElementById('videoGrid').innerHTML = videos.map(v => {
    const vj = escJson(v);
    return `<div class="video-card" onclick="playVideo(${vj})">
      <div class="thumb-wrap">
        <img src="${escHtml(v.thumb)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0">
        <div class="qual-badge">${escHtml(v.quality||'HD')}</div>
        ${v.duration?`<div class="dur-badge">${escHtml(v.duration)}</div>`:''}
        <div class="play-overlay"><svg viewBox="0 0 60 60" fill="none"><circle cx="30" cy="30" r="30" fill="rgba(0,0,0,0.5)"/><polygon points="24,18 44,30 24,42" fill="white"/></svg></div>
      </div>
      <div class="card-info">
        <div class="card-title">${escHtml(v.title)}</div>
        ${v.uploader?`<div class="card-meta"><span>${escHtml(v.uploader)}</span></div>`:''}
      </div></div>`;
  }).join('');
}

function escJson(obj) {
  return JSON.stringify(obj).replace(/&/g,'\\u0026').replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/'/g,'\\u0027').replace(/"/g,'&quot;');
}

function showSkeletons() {
  document.getElementById('videoGrid').innerHTML = Array(16).fill(0).map(() =>
    `<div class="skel-card"><div class="skel skel-thumb"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>`
  ).join('');
}

function showError(msg) {
  document.getElementById('videoGrid').innerHTML = `<div class="fetch-error"><div style="font-size:44px">&#128225;</div><h3>Oops</h3><p>${escHtml(msg)}</p></div>`;
}

function changePage(dir) {
  const next = currentPage + dir;
  if (next < 0) return;
  loadUrl(currentPageUrl, next, currentLabel);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function playVideo(v) {
  if (loadController) loadController.abort();
  loadController = new AbortController();

  document.getElementById('home-page').style.display = 'none';
  document.getElementById('player-page').style.display = 'block';
  document.getElementById('catNav').style.display = 'none';
  document.getElementById('siteFooter').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'auto' });

  document.getElementById('vTitle').textContent = v.title;
  document.getElementById('vDur').textContent = v.duration || '—';
  document.getElementById('vQual').textContent = v.quality || 'HD';
  document.getElementById('vUploader').textContent = v.uploader || '';
  document.getElementById('loadOverlay').style.display = 'flex';
  document.getElementById('errMsg').style.display = 'none';
  document.getElementById('bigPlay').classList.remove('visible');

  hlsLevels = [];
  currentQualityIndex = -1;
  streamSources = { hls: null, mp4high: null, mp4low: null };
  resetQualitySheet();
  resetDownloadSheet();

  const related = cachedVideos.filter(x => x.eid !== v.eid).slice(0, 14);
  document.getElementById('relatedList').innerHTML = related.map(r => {
    const rj = escJson(r);
    return `<div class="related-card" onclick="playVideo(${rj})">
      <img class="related-thumb" src="${escHtml(r.thumb)}" alt="" loading="lazy" onerror="this.style.opacity=0">
      <div class="related-info"><div class="related-title">${escHtml(r.title)}</div>
      <div class="related-meta">${escHtml(r.duration||'')} · ${escHtml(r.uploader||'')}</div></div></div>`;
  }).join('');

  try {
    const data = await apiFetch(`${API}?url=${encodeURIComponent(v.url)}`, loadController.signal);
    if (data.error) throw new Error(data.error);
    if (data.title) document.getElementById('vTitle').textContent = data.title;
    streamSources = { hls: data.hls, mp4high: data.mp4high, mp4low: data.mp4low };
    buildDownloadSheet();
    startStream(data.hls, data.mp4high, data.mp4low);
  } catch (err) {
    if (err.name === 'AbortError') return;
    document.getElementById('loadOverlay').style.display = 'none';
    const e = document.getElementById('errMsg');
    e.style.display = 'block'; e.textContent = err.message;
  }
}

function startStream(hls, mp4high, mp4low) {
  const video = document.getElementById('main-video');
  const overlay = document.getElementById('loadOverlay');
  if (currentHls) { currentHls.destroy(); currentHls = null; }
  video.src = '';
  const hideOverlay = () => { overlay.style.display = 'none'; };

  if (hls) {
    if (window.Hls && Hls.isSupported()) {
      currentHls = new Hls({ maxBufferLength: 20, enableWorker: true, lowLatencyMode: false });
      const proxyUrl = `${API}?stream=true&url=${encodeURIComponent(hls)}`;
      currentHls.loadSource(proxyUrl);
      currentHls.attachMedia(video);
      currentHls.on(Hls.Events.MANIFEST_PARSED, (ev, data) => {
        hideOverlay();
        video.play().catch(() => { document.getElementById('bigPlay').classList.add('visible'); });
        buildHlsQualitySheet(data.levels);
      });
      currentHls.on(Hls.Events.LEVEL_SWITCHED, (ev, data) => { updateActiveQuality(data.level); });
      currentHls.on(Hls.Events.ERROR, (ev, d) => { if (d.fatal) { hideOverlay(); fallbackMp4(mp4high, mp4low); } });
      return;
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = `${API}?stream=true&url=${encodeURIComponent(hls)}`;
      video.onloadedmetadata = () => { hideOverlay(); video.play().catch(() => { document.getElementById('bigPlay').classList.add('visible'); }); };
      buildFallbackQualitySheet();
      return;
    }
  }
  fallbackMp4(mp4high, mp4low);
}

function fallbackMp4(hi, lo) {
  const video = document.getElementById('main-video');
  const overlay = document.getElementById('loadOverlay');
  const src = hi || lo;
  if (!src) { overlay.style.display = 'none'; return; }
  video.src = src;
  video.onloadeddata = () => {
    overlay.style.display = 'none';
    video.play().catch(() => { document.getElementById('bigPlay').classList.add('visible'); });
  };
  video.onerror = () => { overlay.style.display = 'none'; };
  buildFallbackQualitySheet();
}

const video = document.getElementById('main-video');
const playerContainer = document.getElementById('playerContainer');

function togglePlay() {
  if (video.paused || video.ended) video.play().catch(() => {});
  else video.pause();
}

function updatePlayPauseIcon() {
  const playing = !video.paused && !video.ended;
  document.getElementById('iconPlay').style.display = playing ? 'none' : 'block';
  document.getElementById('iconPause').style.display = playing ? 'block' : 'none';
  document.getElementById('bigPlay').classList.toggle('visible', video.paused && !video.ended && video.readyState > 0);
}

video.addEventListener('play', updatePlayPauseIcon);
video.addEventListener('pause', updatePlayPauseIcon);
video.addEventListener('ended', () => { updatePlayPauseIcon(); document.getElementById('bigPlay').classList.add('visible'); });

function seekRelative(secs) {
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + secs));
  const id = secs < 0 ? 'seekLeft' : 'seekRight';
  const el = document.getElementById(id);
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 300);
}

const volumeSlider = document.getElementById('volumeSlider');
volumeSlider.addEventListener('input', () => {
  video.volume = parseFloat(volumeSlider.value);
  video.muted = false;
  updateVolumeIcon();
});

function toggleMute() {
  video.muted = !video.muted;
  if (!video.muted && video.volume === 0) { video.volume = 0.5; volumeSlider.value = 0.5; }
  updateVolumeIcon();
}

function updateVolumeIcon() {
  const off = video.muted || video.volume === 0;
  document.getElementById('iconVolOn').style.display = off ? 'none' : 'block';
  document.getElementById('iconVolOff').style.display = off ? 'block' : 'none';
  if (!video.muted) volumeSlider.value = video.volume;
}

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

video.addEventListener('timeupdate', () => {
  if (isDragging) return;
  const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
  document.getElementById('progressPlayed').style.width = pct + '%';
  document.getElementById('progressThumb').style.left = pct + '%';
  document.getElementById('ctrlTime').textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
});

video.addEventListener('progress', () => {
  if (video.buffered.length > 0) {
    const end = video.buffered.end(video.buffered.length - 1);
    const pct = video.duration ? (end / video.duration) * 100 : 0;
    document.getElementById('progressBuffered').style.width = pct + '%';
  }
});

const progressWrap = document.getElementById('progressWrap');
const progressTooltip = document.getElementById('progressTooltip');
function getProgressPct(e) {
  const rect = progressWrap.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}
function onProgressDown(e) {
  isDragging = true;
  progressWrap.classList.add('dragging');
  seekToProgress(e);
  document.addEventListener('mousemove', onProgressMove);
  document.addEventListener('mouseup', onProgressUp);
  document.addEventListener('touchmove', onProgressMove, { passive:false });
  document.addEventListener('touchend', onProgressUp);
}
function onProgressMove(e) {
  if (!isDragging) return;
  if (e.cancelable) e.preventDefault();
  const pct = getProgressPct(e);
  document.getElementById('progressPlayed').style.width = (pct * 100) + '%';
  document.getElementById('progressThumb').style.left = (pct * 100) + '%';
  if (video.duration) {
    progressTooltip.textContent = formatTime(pct * video.duration);
    const rect = progressWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    progressTooltip.style.left = (clientX - rect.left) + 'px';
  }
}
function onProgressUp(e) {
  if (isDragging) seekToProgress(e);
  isDragging = false;
  progressWrap.classList.remove('dragging');
  document.removeEventListener('mousemove', onProgressMove);
  document.removeEventListener('mouseup', onProgressUp);
  document.removeEventListener('touchmove', onProgressMove);
  document.removeEventListener('touchend', onProgressUp);
}
function seekToProgress(e) {
  if (!video.duration) return;
  const pct = getProgressPct(e);
  video.currentTime = pct * video.duration;
}
progressWrap.addEventListener('mousedown', onProgressDown);
progressWrap.addEventListener('touchstart', onProgressDown, { passive:true });
progressWrap.addEventListener('mousemove', (e) => {
  if (isDragging) return;
  const pct = getProgressPct(e);
  if (video.duration) {
    progressTooltip.textContent = formatTime(pct * video.duration);
    const rect = progressWrap.getBoundingClientRect();
    progressTooltip.style.left = (e.clientX - rect.left) + 'px';
  }
});

function showControls() { playerContainer.classList.remove('controls-hidden'); resetControlsTimeout(); }
function resetControlsTimeout() { clearTimeout(controlsTimeout); controlsTimeout = setTimeout(() => { if (!video.paused && !isDragging) playerContainer.classList.add('controls-hidden'); }, 3000); }
playerContainer.addEventListener('mousemove', showControls);
playerContainer.addEventListener('touchstart', () => { if (playerContainer.classList.contains('controls-hidden')) showControls(); else if (!video.paused) playerContainer.classList.add('controls-hidden'); }, { passive:true });
video.addEventListener('play', resetControlsTimeout);
video.addEventListener('pause', () => { clearTimeout(controlsTimeout); playerContainer.classList.remove('controls-hidden'); });

function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = playerContainer;
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
}
function onFsChange() {
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  playerContainer.classList.toggle('fullscreen', fs);
  document.getElementById('iconFsOn').style.display = fs ? 'none' : 'block';
  document.getElementById('iconFsOff').style.display = fs ? 'block' : 'none';
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

document.addEventListener('keydown', (e) => {
  if (document.getElementById('player-page').style.display !== 'block') return;
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ': case 'k': e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft': e.preventDefault(); seekRelative(-10); break;
    case 'ArrowRight': e.preventDefault(); seekRelative(10); break;
    case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); updateVolumeIcon(); break;
    case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); updateVolumeIcon(); break;
    case 'f': e.preventDefault(); toggleFullscreen(); break;
    case 'm': e.preventDefault(); toggleMute(); break;
  }
});

function openQualitySheet() { closeDownloadSheet(); document.getElementById('qualityBackdrop').classList.add('open'); document.getElementById('qualitySheet').classList.add('open'); }
function closeQualitySheet() { document.getElementById('qualityBackdrop').classList.remove('open'); document.getElementById('qualitySheet').classList.remove('open'); }

function getQualityLabel(h) { if (h >= 1080) return '1080p'; if (h >= 720) return '720p'; if (h >= 480) return '480p'; if (h >= 360) return '360p'; if (h >= 240) return '240p'; return h + 'p'; }

function buildHlsQualitySheet(levels) {
  hlsLevels = levels || [];
  const list = document.getElementById('qualitySheetList');
  const sorted = levels.map((l,i) => ({ index:i, height:l.height, width:l.width, bitrate:l.bitrate })).sort((a,b) => b.height - a.height);
  let html = `<button class="sheet-item ${currentQualityIndex===-1?'active':''}" onclick="setQuality(-1,this)"><div class="sheet-item-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg></div><span class="sheet-item-label">Auto</span><span class="sheet-item-sub">Adaptive</span></button><div class="sheet-divider"></div>`;
  sorted.forEach(l => {
    const label = getQualityLabel(l.height);
    const res = `${l.width}×${l.height}`;
    html += `<button class="sheet-item ${currentQualityIndex===l.index?'active':''}" data-level="${l.index}" onclick="setQuality(${l.index},this)"><div class="sheet-item-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg></div><span class="sheet-item-label">${label}</span><span class="sheet-item-sub">${res}</span></button>`;
  });
  list.innerHTML = html;
}

function buildFallbackQualitySheet() {
  const list = document.getElementById('qualitySheetList');
  let html = '';
  if (streamSources.mp4high) html += `<button class="sheet-item active" data-source="mp4high" onclick="setMp4Quality('mp4high',this)"><div class="sheet-item-check" style="border-color:var(--red);background:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="opacity:1"><path d="M20 6 9 17l-5-5"/></svg></div><span class="sheet-item-label">High</span><span class="sheet-item-sub">720p</span></button>`;
  if (streamSources.mp4low) html += `<button class="sheet-item ${!streamSources.mp4high?'active':''}" data-source="mp4low" onclick="setMp4Quality('mp4low',this)"><div class="sheet-item-check" style="border-color:var(--text3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="opacity:1"><path d="M20 6 9 17l-5-5"/></svg></div><span class="sheet-item-label">Standard</span><span class="sheet-item-sub">480p</span></button>`;
  if (!html) html = '<div style="padding:14px;font-size:13px;color:var(--text3)">No quality options</div>';
  list.innerHTML = html;
}

function resetQualitySheet() {
  document.getElementById('qualitySheetList').innerHTML = `<button class="sheet-item active" onclick="setQuality(-1,this)"><div class="sheet-item-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg></div><span class="sheet-item-label">Auto</span><span class="sheet-item-sub">Adaptive</span></button>`;
}

function setQuality(levelIndex, el) {
  if (!currentHls) return;
  const overlay = document.getElementById('qualitySwitchOverlay');
  overlay.classList.add('visible');
  currentQualityIndex = levelIndex;
  currentHls.currentLevel = levelIndex;
  document.querySelectorAll('#qualitySheetList .sheet-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  currentHls.once(Hls.Events.FRAG_LOADED, () => { overlay.classList.remove('visible'); });
  setTimeout(() => overlay.classList.remove('visible'), 3000);
  closeQualitySheet();
}

function setMp4Quality(sourceKey, el) {
  const currentTime = video.currentTime;
  const wasPlaying = !video.paused;
  const overlay = document.getElementById('qualitySwitchOverlay');
  overlay.classList.add('visible');
  const nextSrc = streamSources[sourceKey];
  if (!nextSrc) { overlay.classList.remove('visible'); return; }
  video.pause();
  const onLoaded = () => {
    video.currentTime = currentTime;
    overlay.classList.remove('visible');
    if (wasPlaying) video.play().catch(() => {});
    video.removeEventListener('loadeddata', onLoaded);
  };
  video.addEventListener('loadeddata', onLoaded);
  video.src = nextSrc;
  document.querySelectorAll('#qualitySheetList .sheet-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  closeQualitySheet();
}

function updateActiveQuality(levelIndex) {
  if (currentQualityIndex !== -1) return;
  document.getElementById('qualitySwitchOverlay').classList.remove('visible');
}

function openDownloadSheet() { closeQualitySheet(); document.getElementById('dlBackdrop').classList.add('open'); document.getElementById('dlSheet').classList.add('open'); }
function closeDownloadSheet() { document.getElementById('dlBackdrop').classList.remove('open'); document.getElementById('dlSheet').classList.remove('open'); }

function buildDownloadSheet() {
  const list = document.getElementById('dlSheetList');
  let html = '';
  const title = document.getElementById('vTitle').textContent || 'video';
  const safeName = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, '').trim().substring(0, 60));
  if (streamSources.mp4high) {
    const dlUrl = `${DL_API}?url=${encodeURIComponent(streamSources.mp4high)}&name=${safeName}`;
    html += `<a class="sheet-item" href="${dlUrl}" style="text-decoration:none;color:inherit" onclick="onDownloadClick(event,'High Quality')"><div class="sheet-item-check" style="border-color:var(--red);background:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><span class="sheet-item-label">High Quality</span><span class="sheet-item-sub">720p MP4</span></a>`;
  }
  if (streamSources.mp4low) {
    const dlUrl = `${DL_API}?url=${encodeURIComponent(streamSources.mp4low)}&name=${safeName}`;
    html += `<a class="sheet-item" href="${dlUrl}" style="text-decoration:none;color:inherit" onclick="onDownloadClick(event,'Standard Quality')"><div class="sheet-item-check" style="border-color:var(--text3)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><span class="sheet-item-label">Standard Quality</span><span class="sheet-item-sub">480p MP4</span></a>`;
  }
  if (!html) html = '<div style="padding:14px;font-size:13px;color:var(--text3)">No downloads available</div>';
  list.innerHTML = html;
}

function resetDownloadSheet() { document.getElementById('dlSheetList').innerHTML = '<div style="padding:14px;font-size:13px;color:var(--text3)">Loading sources...</div>'; }
function onDownloadClick(e, label) { closeDownloadSheet(); showToast(`Downloading ${label}...`); }
function quickDownload() {
  const url = streamSources.mp4high || streamSources.mp4low;
  if (!url) { showToast('No download source available'); return; }
  const title = document.getElementById('vTitle').textContent || 'video';
  const safeName = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, '').trim().substring(0, 60));
  const label = streamSources.mp4high ? 'High Quality' : 'Standard Quality';
  const dlUrl = `${DL_API}?url=${encodeURIComponent(url)}&name=${safeName}`;
  showToast(`Downloading ${label}...`);
  const a = document.createElement('a');
  a.href = dlUrl;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('dlToast');
  document.getElementById('dlToastMsg').textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function goHome() {
  if (currentHls) { currentHls.destroy(); currentHls = null; }
  video.src = '';
  document.getElementById('player-page').style.display = 'none';
  document.getElementById('home-page').style.display = 'block';
  document.getElementById('catNav').style.display = '';
  document.getElementById('siteFooter').style.display = '';
  closeQualitySheet();
  closeDownloadSheet();
  closeSuggestions();
}

loadUrl(HOME_URL, 0, 'Trending');
