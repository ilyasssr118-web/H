const API = '/api/get-video';
const DL_API = '/api/download';
const HOME_URL = 'https://www.xvideos.com/';
const HISTORY_KEY = 'sx_history';

const state = {
  currentHls: null,
  currentPageUrl: HOME_URL,
  currentPage: 0,
  currentLabel: 'Trending',
  searchQuery: '',
  cachedVideos: [],
  relatedVideos: [],
  gridVideos: [],
  suggestionItems: [],
  qualityItems: [],
  downloadItems: [],
  loadController: null,
  suggestionController: null,
  hlsLevels: [],
  currentQualityIndex: -1,
  selectedDownloadKey: '',
  streamSources: { hls: null, mp4high: null, mp4low: null },
  currentPlaybackSourceKey: '',
  controlsTimeout: null,
  isDragging: false,
  sugDebounce: null,
  searchHistory: JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'),
  sugFocusIdx: -1,
  activeVideo: null,
};

const dom = {};

function cacheDom() {
  const ids = [
    'homeLogo', 'searchInput', 'searchBtn', 'suggestions', 'catNav', 'catInner',
    'home-page', 'player-page', 'siteFooter', 'pageLabel', 'videoGrid', 'pagination',
    'prevBtn', 'nextBtn', 'pageInfo', 'backBtn', 'playerContainer', 'main-video',
    'loadOverlay', 'qualitySwitchOverlay', 'bigPlay', 'seekLeft', 'seekRight',
    'customControls', 'progressWrap', 'progressTrack', 'progressBuffered',
    'progressPlayed', 'progressThumb', 'progressTooltip', 'playPauseBtn', 'iconPlay',
    'iconPause', 'rewindBtn', 'forwardBtn', 'volumeWrap', 'volumeBtn', 'iconVolOn',
    'iconVolOff', 'volumeSlider', 'ctrlTime', 'qualityCtrlBtn', 'fullscreenBtn',
    'iconFsOn', 'iconFsOff', 'qualityBackdrop', 'qualitySheet', 'qualityCloseBtn',
    'qualitySheetList', 'errMsg', 'vTitle', 'vDur', 'vQual', 'vUploader',
    'downloadBtn', 'quickDownloadBtn', 'relatedList', 'dlBackdrop', 'dlSheet',
    'dlCloseBtn', 'dlSheetList', 'dlToast', 'dlToastMsg'
  ];

  for (const id of ids) dom[id] = document.getElementById(id);
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(input) {
  return String(input ?? 'video')
    .replace(/[^a-zA-Z0-9_ -]/g, '')
    .trim()
    .slice(0, 80) || 'video';
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function decodeHtml(s) {
  return String(s ?? '')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&comma;/g, ',')
    .replace(/&period;/g, '.')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '...');
}

async function requestJSON(url, signal) {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function buildPagedUrl(base, page) {
  if (page === 0) return base;
  try {
    const url = new URL(base);
    if (url.searchParams.has('k')) {
      url.searchParams.set('p', String(page));
      return url.toString();
    }
  } catch {
    // fall through
  }

  if (/\/new\/?$/.test(base) || /\/best\/?$/.test(base)) {
    return base.replace(/\/?$/, '') + '/' + page;
  }
  if (base.includes('?')) return `${base}&p=${page}`;
  return base.replace(/\/?$/, '') + '/new/' + page;
}

function setView(view) {
  const homeVisible = view === 'home';
  dom['home-page'].style.display = homeVisible ? 'block' : 'none';
  dom['player-page'].style.display = homeVisible ? 'none' : 'block';
  dom.catNav.style.display = homeVisible ? '' : 'none';
  dom.siteFooter.style.display = homeVisible ? '' : 'none';
}

function openSheet(sheet) {
  closeAllSheets();
  if (sheet === 'quality') {
    dom.qualityBackdrop.classList.add('open');
    dom.qualitySheet.classList.add('open');
  } else if (sheet === 'download') {
    dom.dlBackdrop.classList.add('open');
    dom.dlSheet.classList.add('open');
  }
}

function closeQualitySheet() {
  dom.qualityBackdrop.classList.remove('open');
  dom.qualitySheet.classList.remove('open');
}

function closeDownloadSheet() {
  dom.dlBackdrop.classList.remove('open');
  dom.dlSheet.classList.remove('open');
}

function closeAllSheets() {
  closeQualitySheet();
  closeDownloadSheet();
  closeSuggestions();
}

function showToast(message) {
  dom.dlToastMsg.textContent = message;
  dom.dlToast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.dlToast.classList.remove('show'), 2600);
}

function showError(message) {
  dom.videoGrid.innerHTML = `<div class="fetch-error"><div style="font-size:44px">&#128225;</div><h3>Oops</h3><p>${escapeHTML(message)}</p></div>`;
}

function showSkeletons() {
  dom.videoGrid.innerHTML = Array.from({ length: 16 }, () => `
    <div class="skel-card">
      <div class="skel skel-thumb"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line short"></div>
    </div>`).join('');
}

function renderVideoGrid(videos) {
  state.gridVideos = videos;
  dom.videoGrid.innerHTML = videos.map((v, index) => `
    <button type="button" class="video-card" data-index="${index}">
      <div class="thumb-wrap">
        <img src="${escapeHTML(v.thumb)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0">
        <div class="qual-badge">${escapeHTML(v.quality || 'HD')}</div>
        ${v.duration ? `<div class="dur-badge">${escapeHTML(v.duration)}</div>` : ''}
        <div class="play-overlay">
          <svg viewBox="0 0 60 60" fill="none">
            <circle cx="30" cy="30" r="30" fill="rgba(0,0,0,0.5)"/>
            <polygon points="24,18 44,30 24,42" fill="white"/>
          </svg>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title">${escapeHTML(v.title)}</div>
        ${v.uploader ? `<div class="card-meta"><span>${escapeHTML(v.uploader)}</span></div>` : ''}
      </div>
    </button>`).join('');
}

function renderRelatedList(videos) {
  state.relatedVideos = videos;
  dom.relatedList.innerHTML = videos.map((v, index) => `
    <button type="button" class="related-card" data-index="${index}">
      <img class="related-thumb" src="${escapeHTML(v.thumb)}" alt="" loading="lazy" onerror="this.style.opacity=0">
      <div class="related-info">
        <div class="related-title">${escapeHTML(v.title)}</div>
        <div class="related-meta">${escapeHTML(v.duration || '')}${v.uploader ? ' · ' + escapeHTML(v.uploader) : ''}</div>
      </div>
    </button>`).join('');
}

function renderSuggestions() {
  const q = dom.searchInput.value.trim();
  if (!q && !state.searchHistory.length) {
    closeSuggestions();
    return;
  }

  const frag = [];
  state.sugFocusIdx = -1;

  if (q) {
    frag.push(`
      <div class="sug-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        Results for "${escapeHTML(q)}"
      </div>`);
    state.suggestionItems.forEach((v, index) => {
      frag.push(`
        <button type="button" class="sug-item" data-kind="video" data-index="${index}">
          <img class="sug-item-thumb" src="${escapeHTML(v.thumb)}" alt="" loading="lazy" onerror="this.style.opacity=0">
          <div class="sug-item-text">
            <div class="sug-item-title">${escapeHTML(v.title)}</div>
            <div class="sug-item-meta">${escapeHTML(v.duration || '')}${v.uploader ? ' · ' + escapeHTML(v.uploader) : ''}</div>
          </div>
          <svg class="sug-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>`);
    });
  } else {
    frag.push(`
      <div class="sug-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Recent searches
      </div>`);
    state.searchHistory.slice(0, 6).forEach((item, index) => {
      frag.push(`
        <button type="button" class="sug-text-item" data-kind="history" data-index="${index}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${escapeHTML(item)}
        </button>`);
    });
    frag.push('<div class="sug-divider"></div>');
    frag.push(`<button type="button" class="sug-clear" data-kind="clear-history">Clear search history</button>`);
  }

  dom.suggestions.innerHTML = frag.join('');
  dom.suggestions.classList.add('open');
}

function closeSuggestions() {
  if (state.suggestionController) state.suggestionController.abort();
  state.suggestionController = null;
  state.sugFocusIdx = -1;
  dom.suggestions.classList.remove('open');
}

async function fetchSuggestions(query) {
  if (state.suggestionController) state.suggestionController.abort();
  state.suggestionController = new AbortController();
  const signal = state.suggestionController.signal;

  try {
    const url = `${API}?search=true&list=true&url=${encodeURIComponent('https://www.xvideos.com/?k=' + encodeURIComponent(query))}`;
    const data = await requestJSON(url, signal);
    state.suggestionItems = (data.videos || []).slice(0, 8);
    if (!state.suggestionItems.length) {
      closeSuggestions();
      return;
    }
    renderSuggestions();
  } catch (err) {
    if (err.name !== 'AbortError') closeSuggestions();
  }
}

function addToHistory(query) {
  const clean = String(query || '').trim();
  if (!clean) return;
  state.searchHistory = state.searchHistory.filter((item) => item.toLowerCase() !== clean.toLowerCase());
  state.searchHistory.unshift(clean);
  if (state.searchHistory.length > 10) state.searchHistory = state.searchHistory.slice(0, 10);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.searchHistory));
}

function clearHistory() {
  state.searchHistory = [];
  localStorage.removeItem(HISTORY_KEY);
  renderSuggestions();
}

function buildDownloadUrl(sourceUrl, title) {
  const safeName = encodeURIComponent(sanitizeFilename(title));
  return `${DL_API}?url=${encodeURIComponent(sourceUrl)}&name=${safeName}`;
}

function getCurrentDownloadKey() {
  if (state.selectedDownloadKey && state.streamSources[state.selectedDownloadKey]) return state.selectedDownloadKey;
  if (state.currentPlaybackSourceKey && state.streamSources[state.currentPlaybackSourceKey]) return state.currentPlaybackSourceKey;
  if (state.streamSources.mp4high) return 'mp4high';
  if (state.streamSources.mp4low) return 'mp4low';
  return '';
}

function renderDownloadSheet() {
  const title = dom.vTitle.textContent || 'video';
  const items = [];
  const currentKey = getCurrentDownloadKey();

  if (state.streamSources.mp4high) {
    items.push({
      key: 'mp4high',
      label: 'High Quality',
      sub: 'Best MP4',
      url: buildDownloadUrl(state.streamSources.mp4high, title),
    });
  }
  if (state.streamSources.mp4low) {
    items.push({
      key: 'mp4low',
      label: 'Standard Quality',
      sub: 'Smaller file',
      url: buildDownloadUrl(state.streamSources.mp4low, title),
    });
  }

  state.downloadItems = items;
  if (!items.length) {
    dom.dlSheetList.innerHTML = '<div style="padding:14px;font-size:13px;color:var(--text3)">No downloads available</div>';
    return;
  }

  dom.dlSheetList.innerHTML = items.map((item) => `
    <button type="button" class="sheet-item ${currentKey === item.key ? 'active' : ''}" data-kind="download" data-key="${item.key}" data-url="${escapeHTML(item.url)}">
      <div class="sheet-item-check ${currentKey === item.key ? 'checked' : ''}" style="${currentKey === item.key ? 'border-color:var(--red);background:var(--red)' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </div>
      <span class="sheet-item-label">${escapeHTML(item.label)}</span>
      <span class="sheet-item-sub">${escapeHTML(item.sub)}</span>
    </button>`).join('');
}

function renderQualitySheetAutoLabel(label) {
  state.qualityItems = state.qualityItems.map((item) => item.key === 'auto' ? { ...item, sub: label || item.sub } : item);
}

function renderHlsQualitySheet(levels) {
  state.hlsLevels = (levels || [])
    .map((level, index) => ({
      index,
      width: level.width,
      height: level.height,
      bitrate: level.bitrate,
    }))
    .filter((level) => level.height);

  const sorted = [...state.hlsLevels].sort((a, b) => b.height - a.height);
  state.qualityItems = [
    { key: 'auto', label: 'Auto', sub: 'Adaptive', levelIndex: -1 },
    ...sorted.map((level) => ({
      key: `level-${level.index}`,
      label: getQualityLabel(level.height),
      sub: `${level.width}×${level.height}`,
      levelIndex: level.index,
    })),
  ];

  dom.qualitySheetList.innerHTML = state.qualityItems.map((item) => `
    <button type="button" class="sheet-item ${state.currentQualityIndex === item.levelIndex ? 'active' : ''}" data-kind="quality" data-level="${item.levelIndex}" data-key="${item.key}">
      <div class="sheet-item-check ${state.currentQualityIndex === item.levelIndex ? 'checked' : ''}" style="${state.currentQualityIndex === item.levelIndex ? 'border-color:var(--red);background:var(--red)' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="opacity:1"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <span class="sheet-item-label">${escapeHTML(item.label)}</span>
      <span class="sheet-item-sub">${escapeHTML(item.sub)}</span>
    </button>`).join('');
}

function renderFallbackQualitySheet() {
  state.qualityItems = [];
  const items = [];
  if (state.streamSources.mp4high) items.push({ key: 'mp4high', label: 'High', sub: '720p MP4' });
  if (state.streamSources.mp4low) items.push({ key: 'mp4low', label: 'Standard', sub: '480p MP4' });

  if (!items.length) {
    dom.qualitySheetList.innerHTML = '<div style="padding:14px;font-size:13px;color:var(--text3)">No quality options</div>';
    return;
  }

  const activeKey = state.currentPlaybackSourceKey || (state.streamSources.mp4high ? 'mp4high' : 'mp4low');
  state.qualityItems = items;
  dom.qualitySheetList.innerHTML = state.qualityItems.map((item) => {
    const isActive = item.key === activeKey ? 'active' : '';
    return `
      <button type="button" class="sheet-item ${isActive}" data-kind="mp4-quality" data-key="${item.key}">
        <div class="sheet-item-check ${isActive ? 'checked' : ''}" style="${isActive ? 'border-color:var(--red);background:var(--red)' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="opacity:1"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <span class="sheet-item-label">${escapeHTML(item.label)}</span>
        <span class="sheet-item-sub">${escapeHTML(item.sub)}</span>
      </button>`;
  }).join('');
}

function resetQualitySheet() {
  state.currentQualityIndex = -1;
  state.qualityItems = [{ key: 'auto', label: 'Auto', sub: 'Adaptive', levelIndex: -1 }];
  dom.qualitySheetList.innerHTML = `
    <button type="button" class="sheet-item active" data-kind="quality" data-level="-1" data-key="auto">
      <div class="sheet-item-check" style="border-color:var(--red);background:var(--red)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="opacity:1"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <span class="sheet-item-label">Auto</span>
      <span class="sheet-item-sub">Adaptive</span>
    </button>`;
}

function getQualityLabel(height) {
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  if (height >= 240) return '240p';
  return `${height}p`;
}

function updateCurrentQualityActive(levelIndex) {
  if (state.currentQualityIndex !== -1) return;
  const autoItem = dom.qualitySheetList.querySelector('[data-key="auto"] .sheet-item-sub');
  if (!autoItem) return;

  const level = state.hlsLevels.find((item) => item.index === levelIndex);
  if (level && level.height) {
    autoItem.textContent = `${getQualityLabel(level.height)} • ${level.width}×${level.height}`;
  }
}

function markSheetActive(container, selector) {
  container.querySelectorAll('.sheet-item').forEach((item) => item.classList.remove('active'));
  const target = container.querySelector(selector);
  if (target) target.classList.add('active');
}

function updatePlayerMeta(videoData) {
  dom.vTitle.textContent = videoData.title || 'Untitled';
  dom.vDur.textContent = videoData.duration || '—';
  dom.vQual.textContent = videoData.quality || 'HD';
  dom.vUploader.textContent = videoData.uploader || '';
}

function updatePlayPauseIcon() {
  const video = dom['main-video'];
  const playing = !video.paused && !video.ended;
  dom.iconPlay.style.display = playing ? 'none' : 'block';
  dom.iconPause.style.display = playing ? 'block' : 'none';
  dom.bigPlay.classList.toggle('visible', video.paused && !video.ended && video.readyState > 0);
}

function updateVolumeIcon() {
  const video = dom['main-video'];
  const off = video.muted || video.volume === 0;
  dom.iconVolOn.style.display = off ? 'none' : 'block';
  dom.iconVolOff.style.display = off ? 'block' : 'none';
  if (!video.muted) dom.volumeSlider.value = String(video.volume);
}

function updateTimeUI() {
  const video = dom['main-video'];
  if (state.isDragging) return;
  const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
  dom.progressPlayed.style.width = `${pct}%`;
  dom.progressThumb.style.left = `${pct}%`;
  dom.ctrlTime.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
}

function updateBufferedUI() {
  const video = dom['main-video'];
  if (video.buffered && video.buffered.length > 0) {
    const end = video.buffered.end(video.buffered.length - 1);
    const pct = video.duration ? (end / video.duration) * 100 : 0;
    dom.progressBuffered.style.width = `${pct}%`;
  }
}

function showControls() {
  dom.playerContainer.classList.remove('controls-hidden');
  resetControlsTimeout();
}

function resetControlsTimeout() {
  clearTimeout(state.controlsTimeout);
  state.controlsTimeout = setTimeout(() => {
    const video = dom['main-video'];
    if (!video.paused && !state.isDragging) {
      dom.playerContainer.classList.add('controls-hidden');
    }
  }, 3000);
}

function getProgressPctFromEvent(e) {
  const rect = dom.progressWrap.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function seekToProgress(e) {
  const video = dom['main-video'];
  if (!video.duration) return;
  video.currentTime = getProgressPctFromEvent(e) * video.duration;
}

function onProgressDown(e) {
  state.isDragging = true;
  dom.progressWrap.classList.add('dragging');
  seekToProgress(e);
  document.addEventListener('mousemove', onProgressMove);
  document.addEventListener('mouseup', onProgressUp);
  document.addEventListener('touchmove', onProgressMove, { passive: false });
  document.addEventListener('touchend', onProgressUp);
}

function onProgressMove(e) {
  if (!state.isDragging) return;
  if (e.cancelable) e.preventDefault();
  const video = dom['main-video'];
  const pct = getProgressPctFromEvent(e);
  dom.progressPlayed.style.width = `${pct * 100}%`;
  dom.progressThumb.style.left = `${pct * 100}%`;
  if (video.duration) {
    dom.progressTooltip.textContent = formatTime(pct * video.duration);
    const rect = dom.progressWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dom.progressTooltip.style.left = `${clientX - rect.left}px`;
  }
}

function onProgressUp(e) {
  if (state.isDragging) seekToProgress(e);
  state.isDragging = false;
  dom.progressWrap.classList.remove('dragging');
  document.removeEventListener('mousemove', onProgressMove);
  document.removeEventListener('mouseup', onProgressUp);
  document.removeEventListener('touchmove', onProgressMove);
  document.removeEventListener('touchend', onProgressUp);
}

function seekRelative(seconds) {
  const video = dom['main-video'];
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  const target = seconds < 0 ? dom.seekLeft : dom.seekRight;
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 300);
}

function togglePlay() {
  const video = dom['main-video'];
  if (video.paused || video.ended) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
}

function toggleMute() {
  const video = dom['main-video'];
  video.muted = !video.muted;
  if (!video.muted && video.volume === 0) {
    video.volume = 0.5;
    dom.volumeSlider.value = '0.5';
  }
  updateVolumeIcon();
}

function toggleFullscreen() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
    return;
  }
  const el = dom.playerContainer;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (request) request.call(el);
}

function onFsChange() {
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  dom.playerContainer.classList.toggle('fullscreen', fs);
  dom.iconFsOn.style.display = fs ? 'none' : 'block';
  dom.iconFsOff.style.display = fs ? 'block' : 'none';
}

function openQualitySheet() {
  closeDownloadSheet();
  openSheet('quality');
}

function openDownloadSheet() {
  closeQualitySheet();
  renderDownloadSheet();
  openSheet('download');
}

function getDownloadPayload() {
  const key = getCurrentDownloadKey();
  if (!key) return null;
  const source = state.streamSources[key];
  const title = dom.vTitle.textContent || 'video';
  return {
    key,
    url: buildDownloadUrl(source, title),
    label: key === 'mp4high' ? 'High Quality' : 'Standard Quality',
  };
}

function startDownloadByKey(key) {
  if (!state.streamSources[key]) return;
  state.selectedDownloadKey = key;
  const payload = getDownloadPayload();
  if (!payload) return;
  showToast(`Downloading ${payload.label}...`);
  const a = document.createElement('a');
  a.href = payload.url;
  a.rel = 'noreferrer noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  closeDownloadSheet();
}

function quickDownload() {
  const payload = getDownloadPayload();
  if (!payload) {
    showToast('No download source available');
    return;
  }
  state.selectedDownloadKey = payload.key;
  showToast(`Downloading ${payload.label}...`);
  const a = document.createElement('a');
  a.href = payload.url;
  a.rel = 'noreferrer noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function setQuality(levelIndex, button) {
  if (!window.Hls || !state.currentHls) return;
  const overlay = dom.qualitySwitchOverlay;
  overlay.classList.add('visible');
  state.currentQualityIndex = levelIndex;
  state.currentHls.currentLevel = levelIndex;
  markSheetActive(dom.qualitySheetList, `[data-level="${levelIndex}"]`);
  if (levelIndex === -1) state.currentQualityIndex = -1;
  state.currentHls.once(window.Hls.Events.FRAG_LOADED, () => overlay.classList.remove('visible'));
  setTimeout(() => overlay.classList.remove('visible'), 3000);
  closeQualitySheet();
}

function setMp4Quality(sourceKey, button) {
  const video = dom['main-video'];
  const nextSrc = state.streamSources[sourceKey];
  if (!nextSrc) return;

  const overlay = dom.qualitySwitchOverlay;
  const currentTime = video.currentTime;
  const wasPlaying = !video.paused;
  overlay.classList.add('visible');
  state.currentPlaybackSourceKey = sourceKey;
  state.selectedDownloadKey = sourceKey;

  const onLoaded = () => {
    video.currentTime = currentTime;
    overlay.classList.remove('visible');
    if (wasPlaying) video.play().catch(() => {});
  };

  video.addEventListener('loadeddata', onLoaded, { once: true });
  video.src = nextSrc;
  video.load();
  markSheetActive(dom.qualitySheetList, `[data-key="${sourceKey}"]`);
  closeQualitySheet();
}

function startStream(hlsUrl, mp4High, mp4Low) {
  const video = dom['main-video'];
  const overlay = dom.loadOverlay;
  if (state.currentHls) {
    state.currentHls.destroy();
    state.currentHls = null;
  }

  video.src = '';
  const hideOverlay = () => {
    overlay.style.display = 'none';
  };

  if (hlsUrl) {
    if (window.Hls && window.Hls.isSupported()) {
      state.currentHls = new window.Hls({ maxBufferLength: 20, enableWorker: true, lowLatencyMode: false });
      const proxyUrl = `${API}?stream=true&url=${encodeURIComponent(hlsUrl)}`;
      state.currentHls.loadSource(proxyUrl);
      state.currentHls.attachMedia(video);
      state.currentHls.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
        hideOverlay();
        video.play().catch(() => dom.bigPlay.classList.add('visible'));
        renderHlsQualitySheet(data.levels || []);
      });
      state.currentHls.on(window.Hls.Events.LEVEL_SWITCHED, (event, data) => {
        updateCurrentQualityActive(data.level);
      });
      state.currentHls.on(window.Hls.Events.ERROR, (event, error) => {
        if (error && error.fatal) {
          hideOverlay();
          fallbackMp4(mp4High, mp4Low);
        }
      });
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = `${API}?stream=true&url=${encodeURIComponent(hlsUrl)}`;
      video.onloadedmetadata = () => {
        hideOverlay();
        video.play().catch(() => dom.bigPlay.classList.add('visible'));
      };
      renderFallbackQualitySheet();
      return;
    }
  }

  fallbackMp4(mp4High, mp4Low);
}

function fallbackMp4(mp4High, mp4Low) {
  const video = dom['main-video'];
  const overlay = dom.loadOverlay;
  const sourceKey = mp4High ? 'mp4high' : 'mp4low';
  const source = mp4High || mp4Low;
  if (!source) {
    overlay.style.display = 'none';
    return;
  }
  state.currentPlaybackSourceKey = sourceKey;
  state.selectedDownloadKey = sourceKey;

  video.src = source;
  video.onloadeddata = () => {
    overlay.style.display = 'none';
    video.play().catch(() => dom.bigPlay.classList.add('visible'));
  };
  video.onerror = () => overlay.style.display = 'none';
  renderFallbackQualitySheet();
}

function goHome() {
  if (state.currentHls) {
    state.currentHls.destroy();
    state.currentHls = null;
  }
  const video = dom['main-video'];
  video.pause();
  video.src = '';
  setView('home');
  closeAllSheets();
}

async function loadUrl(url, page = 0, label = null) {
  if (state.loadController) state.loadController.abort();
  state.loadController = new AbortController();
  const signal = state.loadController.signal;
  state.currentPageUrl = url;
  state.currentPage = page;
  if (label !== null) {
    state.currentLabel = label;
    state.searchQuery = label.startsWith('🔍 ') ? label.slice(3).replace(/^"|"$/g, '') : '';
  }

  setView('home');
  dom.pageLabel.textContent = state.currentLabel;
  dom.pagination.style.display = 'none';
  dom.searchInput.value = state.searchQuery;
  showSkeletons();

  try {
    const pagedUrl = buildPagedUrl(url, page);
    const data = await requestJSON(`${API}?list=true&url=${encodeURIComponent(pagedUrl)}`, signal);
    const videos = data.videos || [];
    if (!videos.length) {
      showError('No videos found.');
      return;
    }
    state.cachedVideos = videos;
    renderVideoGrid(videos);
    dom.pagination.style.display = 'flex';
    dom.pageInfo.textContent = `Page ${page + 1}`;
    dom.prevBtn.disabled = page === 0;
    dom.nextBtn.disabled = videos.length < 16;
  } catch (err) {
    if (err.name === 'AbortError') return;
    showError('Failed to load videos. Check your API.');
  }
}

function doSearch() {
  const q = dom.searchInput.value.trim();
  closeSuggestions();
  if (!q) {
    state.searchQuery = '';
    loadUrl(HOME_URL, 0, 'Trending');
    return;
  }
  state.searchQuery = q;
  addToHistory(q);
  loadUrl(`https://www.xvideos.com/?k=${encodeURIComponent(q)}`, 0, `🔍 "${q}"`);
}

async function playVideo(videoData) {
  if (!videoData) return;
  if (state.loadController) state.loadController.abort();
  state.loadController = new AbortController();

  setView('player');
  window.scrollTo({ top: 0, behavior: 'auto' });
  state.activeVideo = videoData;
  updatePlayerMeta(videoData);
  dom.loadOverlay.style.display = 'flex';
  dom.errMsg.style.display = 'none';
  dom.bigPlay.classList.remove('visible');
  state.hlsLevels = [];
  state.currentQualityIndex = -1;
  state.streamSources = { hls: null, mp4high: null, mp4low: null };
  state.currentPlaybackSourceKey = '';
  state.selectedDownloadKey = '';
  resetQualitySheet();
  dom.dlSheetList.innerHTML = '<div style="padding:12px 14px;font-size:13px;color:var(--text3)">Loading sources...</div>';

  const related = state.cachedVideos.filter((item) => item.eid !== videoData.eid).slice(0, 14);
  renderRelatedList(related);

  try {
    const data = await requestJSON(`${API}?url=${encodeURIComponent(videoData.url)}`, state.loadController.signal);
    if (data.error) throw new Error(data.error);
    updatePlayerMeta({
      title: data.title || videoData.title,
      duration: videoData.duration,
      quality: videoData.quality,
      uploader: videoData.uploader,
    });

      state.streamSources = {
      hls: data.hls || null,
      mp4high: data.mp4high || null,
      mp4low: data.mp4low || null,
    };

    renderDownloadSheet();
    startStream(data.hls, data.mp4high, data.mp4low);
  } catch (err) {
    if (err.name === 'AbortError') return;
    dom.loadOverlay.style.display = 'none';
    dom.errMsg.style.display = 'block';
    dom.errMsg.textContent = err.message;
  }
}

function onSearchInput() {
  clearTimeout(state.sugDebounce);
  const q = dom.searchInput.value.trim();
  if (!q) {
    state.suggestionItems = [];
    renderSuggestions();
    return;
  }
  state.sugDebounce = setTimeout(() => fetchSuggestions(q), 260);
}

function onSearchFocus() {
  const q = dom.searchInput.value.trim();
  if (!q) {
    state.suggestionItems = [];
    renderSuggestions();
  } else {
    fetchSuggestions(q);
  }
}

function updateSuggestionFocus() {
  const buttons = dom.suggestions.querySelectorAll('button[data-kind]');
  buttons.forEach((button, index) => {
    button.classList.toggle('focused', index === state.sugFocusIdx);
  });
  if (state.sugFocusIdx >= 0 && buttons[state.sugFocusIdx]) {
    buttons[state.sugFocusIdx].scrollIntoView({ block: 'nearest' });
  }
}

function onSearchKeydown(e) {
  const items = dom.suggestions.querySelectorAll('button[data-kind]');
  if (!items.length || !dom.suggestions.classList.contains('open')) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.sugFocusIdx = Math.min(state.sugFocusIdx + 1, items.length - 1);
    updateSuggestionFocus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.sugFocusIdx = Math.max(state.sugFocusIdx - 1, -1);
    updateSuggestionFocus();
  } else if (e.key === 'Enter' && state.sugFocusIdx >= 0) {
    e.preventDefault();
    items[state.sugFocusIdx].click();
  } else if (e.key === 'Escape') {
    closeSuggestions();
  }
}

function onDocumentClick(e) {
  if (!e.target.closest('.search-wrap')) closeSuggestions();
}

function onSuggestionsClick(e) {
  const button = e.target.closest('button[data-kind]');
  if (!button) return;

  const kind = button.dataset.kind;
  if (kind === 'video') {
    const item = state.suggestionItems[Number(button.dataset.index)];
    closeSuggestions();
    if (item) playVideo(item);
  } else if (kind === 'history') {
    const item = state.searchHistory[Number(button.dataset.index)];
    if (item) {
      dom.searchInput.value = item;
      closeSuggestions();
      doSearch();
    }
  } else if (kind === 'clear-history') {
    clearHistory();
  }
}

function onGridClick(e) {
  const button = e.target.closest('button.video-card');
  if (!button) return;
  const item = state.gridVideos[Number(button.dataset.index)];
  if (item) playVideo(item);
}

function onRelatedClick(e) {
  const button = e.target.closest('button.related-card');
  if (!button) return;
  const item = state.relatedVideos[Number(button.dataset.index)];
  if (item) playVideo(item);
}

function onCategoryClick(e) {
  const button = e.target.closest('button.cat-chip');
  if (!button) return;
  document.querySelectorAll('.cat-chip').forEach((chip) => chip.classList.remove('active'));
  button.classList.add('active');
  state.searchQuery = '';
  loadUrl(button.dataset.url, 0, button.dataset.label);
}

function onFooterClick(e) {
  const link = e.target.closest('[data-nav]');
  if (!link) return;
  e.preventDefault();
  const nav = link.dataset.nav;
  if (nav === 'home') {
    loadUrl(HOME_URL, 0, 'Trending');
  } else if (nav === 'new') {
    const chip = document.querySelector('.cat-chip[data-label="New"]');
    if (chip) chip.click();
  } else if (nav === 'best') {
    const chip = document.querySelector('.cat-chip[data-label="Best"]');
    if (chip) chip.click();
  }
}

function onQualitySheetClick(e) {
  const button = e.target.closest('button[data-kind]');
  if (!button) return;
  const kind = button.dataset.kind;
  if (kind === 'quality') {
    setQuality(Number(button.dataset.level), button);
  } else if (kind === 'mp4-quality') {
    setMp4Quality(button.dataset.key, button);
  }
}

function onDownloadSheetClick(e) {
  const button = e.target.closest('button[data-kind="download"]');
  if (!button) return;
  const key = button.dataset.key;
  if (!key || !state.streamSources[key]) return;
  state.selectedDownloadKey = key;
  startDownloadByKey(key);
}

function onPlayerContainerTouch(e) {
  if (e.target.closest('button, input, .progress-wrap')) return;
  if (dom.playerContainer.classList.contains('controls-hidden')) {
    showControls();
  } else if (!dom['main-video'].paused) {
    dom.playerContainer.classList.add('controls-hidden');
  }
}

function initPlayerEvents() {
  const video = dom['main-video'];
  video.addEventListener('play', () => {
    updatePlayPauseIcon();
    resetControlsTimeout();
  });
  video.addEventListener('pause', () => {
    updatePlayPauseIcon();
    clearTimeout(state.controlsTimeout);
    dom.playerContainer.classList.remove('controls-hidden');
  });
  video.addEventListener('ended', () => {
    updatePlayPauseIcon();
    dom.bigPlay.classList.add('visible');
  });
  video.addEventListener('timeupdate', updateTimeUI);
  video.addEventListener('progress', updateBufferedUI);
  video.addEventListener('volumechange', updateVolumeIcon);
  video.addEventListener('loadedmetadata', updateTimeUI);

  video.addEventListener('waiting', () => {
    if (!dom.loadOverlay.style.display || dom.loadOverlay.style.display === 'none') {
      dom.qualitySwitchOverlay.classList.add('visible');
      setTimeout(() => dom.qualitySwitchOverlay.classList.remove('visible'), 1200);
    }
  });

  dom.volumeSlider.addEventListener('input', () => {
    video.volume = parseFloat(dom.volumeSlider.value);
    video.muted = false;
    updateVolumeIcon();
  });

  dom.progressWrap.addEventListener('mousedown', onProgressDown);
  dom.progressWrap.addEventListener('touchstart', onProgressDown, { passive: true });
  dom.progressWrap.addEventListener('mousemove', (e) => {
    if (state.isDragging) return;
    const pct = getProgressPctFromEvent(e);
    if (video.duration) {
      dom.progressTooltip.textContent = formatTime(pct * video.duration);
      const rect = dom.progressWrap.getBoundingClientRect();
      dom.progressTooltip.style.left = `${e.clientX - rect.left}px`;
    }
  });

  dom.playerContainer.addEventListener('mousemove', showControls);
  dom.playerContainer.addEventListener('touchstart', onPlayerContainerTouch, { passive: true });
  video.addEventListener('play', () => dom.bigPlay.classList.remove('visible'));

  dom.playPauseBtn.addEventListener('click', togglePlay);
  dom.bigPlay.addEventListener('click', togglePlay);
  dom.rewindBtn.addEventListener('click', () => seekRelative(-10));
  dom.forwardBtn.addEventListener('click', () => seekRelative(10));
  dom.volumeBtn.addEventListener('click', toggleMute);
  dom.fullscreenBtn.addEventListener('click', toggleFullscreen);
  dom.qualityCtrlBtn.addEventListener('click', openQualitySheet);
  dom.downloadBtn.addEventListener('click', openDownloadSheet);
  dom.quickDownloadBtn.addEventListener('click', quickDownload);
  dom.qualityCloseBtn.addEventListener('click', closeQualitySheet);
  dom.dlCloseBtn.addEventListener('click', closeDownloadSheet);
  dom.backBtn.addEventListener('click', goHome);
  dom.prevBtn.addEventListener('click', () => changePage(-1));
  dom.nextBtn.addEventListener('click', () => changePage(1));
  dom.searchBtn.addEventListener('click', doSearch);
  dom.homeLogo.addEventListener('click', () => goHome());
  dom.searchInput.addEventListener('input', onSearchInput);
  dom.searchInput.addEventListener('focus', onSearchFocus);
  dom.searchInput.addEventListener('keydown', onSearchKeydown);
  dom.videoGrid.addEventListener('click', onGridClick);
  dom.relatedList.addEventListener('click', onRelatedClick);
  dom.suggestions.addEventListener('click', onSuggestionsClick);
  dom.catInner.addEventListener('click', onCategoryClick);
  dom.qualitySheetList.addEventListener('click', onQualitySheetClick);
  dom.dlSheetList.addEventListener('click', onDownloadSheetClick);
  dom.qualityBackdrop.addEventListener('click', closeQualitySheet);
  dom.dlBackdrop.addEventListener('click', closeDownloadSheet);
  document.querySelector('.footer-inner').addEventListener('click', onFooterClick);

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', (e) => {
    if (dom['player-page'].style.display !== 'block') return;
    if (e.target && e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekRelative(-10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekRelative(10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        video.muted = false;
        updateVolumeIcon();
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        updateVolumeIcon();
        break;
      case 'f':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'm':
        e.preventDefault();
        toggleMute();
        break;
    }
  });

  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
}

function changePage(direction) {
  const next = state.currentPage + direction;
  if (next < 0) return;
  window.scrollTo({ top: 0, behavior: 'auto' });
  loadUrl(state.currentPageUrl, next, state.currentLabel);
}

function initSearchHistory() {
  if (!Array.isArray(state.searchHistory)) state.searchHistory = [];
  state.searchHistory = state.searchHistory.map((item) => String(item || '').trim()).filter(Boolean);
}

function init() {
  cacheDom();
  initSearchHistory();
  initPlayerEvents();
  resetQualitySheet();
  closeAllSheets();
  loadUrl(HOME_URL, 0, 'Trending');
}

document.addEventListener('DOMContentLoaded', init);
