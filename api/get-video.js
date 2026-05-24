const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.xvideos.com/',
};

const ALLOWED_HOSTS = [
  'xvideos.com',
  'www.xvideos.com',
  'xvideos-cdn.com',
  'www.xvideos-cdn.com',
  'cdn77.xvideos-cdn.com',
  'mp4-cdn77.xvideos-cdn.com',
  'edge.xvideos-cdn.com',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url: videoUrl, list, stream } = req.query;

  try {
    if (list === 'true') {
      const targetUrl = videoUrl || 'https://www.xvideos.com/';
      assertAllowedUrl(targetUrl);
      const resp = await fetchWithTimeout(targetUrl, {
        headers: { ...BASE_HEADERS, Accept: 'text/html' },
      });
      if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });

      const html = await resp.text();
      const videos = parseVideos(html);
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.status(200).json({ videos });
    }

    if (!stream && videoUrl) {
      assertAllowedUrl(videoUrl);
      const resp = await fetchWithTimeout(videoUrl, {
        headers: { ...BASE_HEADERS, Accept: 'text/html' },
      });
      if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });

      const html = await resp.text();
      const hlsMatch = html.match(/setVideoHLS\('([^']+)'\)/);
      const mp4High = html.match(/setVideoUrlHigh\('([^']+)'\)/);
      const mp4Low = html.match(/setVideoUrlLow\('([^']+)'\)/);

      res.setHeader('Cache-Control', 'public, s-maxage=30');
      return res.status(200).json({
        hls: hlsMatch?.[1] || null,
        mp4high: mp4High?.[1] || null,
        mp4low: mp4Low?.[1] || null,
      });
    }

    if (stream === 'true' && videoUrl) {
      assertAllowedUrl(videoUrl);
      const upstream = await fetchWithTimeout(videoUrl, {
        headers: buildStreamHeaders(req, videoUrl),
      });
      if (!upstream.ok) return res.status(upstream.status).json({ error: `Upstream HTTP ${upstream.status}` });

      const contentType = upstream.headers.get('content-type') || '';
      const isPlaylist = contentType.includes('mpegurl') || /\.m3u8(?:\?|$)/i.test(videoUrl);

      if (isPlaylist) {
        const text = await upstream.text();
        const rewritten = rewritePlaylist(text, videoUrl);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.status(200).send(rewritten);
      }

      passthroughHeaders(res, upstream, contentType || 'application/octet-stream');
      if (!upstream.body) return res.end();
      const { Readable } = await import('node:stream');
      const { pipeline } = await import('node:stream/promises');
      res.status(upstream.status === 206 ? 206 : 200);
      await pipeline(Readable.fromWeb(upstream.body), res);
      return;
    }

    return res.status(400).json({ error: 'Invalid request' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function buildStreamHeaders(req, videoUrl) {
  const headers = {
    ...BASE_HEADERS,
    Accept: '*/*',
    Origin: 'https://www.xvideos.com',
  };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
  if (req.headers['if-modified-since']) headers['If-Modified-Since'] = req.headers['if-modified-since'];
  return headers;
}

function passthroughHeaders(res, upstream, contentType) {
  res.setHeader('Content-Type', contentType);
  const headerMap = {
    'content-length': 'Content-Length',
    'content-range': 'Content-Range',
    'accept-ranges': 'Accept-Ranges',
    'cache-control': 'Cache-Control',
    'etag': 'ETag',
    'last-modified': 'Last-Modified',
  };
  for (const [source, target] of Object.entries(headerMap)) {
    const value = upstream.headers.get(source);
    if (value) res.setHeader(target, value);
  }
}

function rewritePlaylist(text, playlistUrl) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const uriRewritten = line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try {
          const abs = new URL(uri, playlistUrl).toString();
          return `URI="${proxyStreamUrl(abs)}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });

      if (!trimmed.startsWith('#')) {
        try {
          const abs = new URL(trimmed, playlistUrl).toString();
          return proxyStreamUrl(abs);
        } catch {
          return line;
        }
      }

      return uriRewritten;
    })
    .join('\n');
}

function proxyStreamUrl(url) {
  return `/api/get-video?stream=true&url=${encodeURIComponent(url)}`;
}

function assertAllowedUrl(raw) {
  const url = new URL(raw);
  const protocol = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(protocol)) {
    throw new Error('Blocked URL protocol');
  }
  if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new Error('Blocked URL host');
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const merged = { ...options, signal: controller.signal };
    return await fetch(url, merged);
  } finally {
    clearTimeout(timer);
  }
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

function parseVideos(html) {
  const videos = [];
  const blockReg = /class="[^"]*thumb-block[^"]*"([\s\S]*?)(?=class="[^"]*thumb-block|<div id="ad-|<div class="pagination)/g;
  let match;

  while ((match = blockReg.exec(html)) !== null && videos.length < 32) {
    const block = match[1];
    const eidM = block.match(/data-eid="([a-z0-9]+)"/i);
    const urlM = block.match(/href="(\/video\.[^"?]+)"/i);
    const thumbM = block.match(/data-src="(https?:\/\/[^"\s]+)"/i) || block.match(/src="(https?:\/\/[^"\s]+)"/i);
    const titleM = block.match(/title="([^"]{5,240})"/i) || block.match(/data-title="([^"]{5,240})"/i);
    const durM = block.match(/<span class="duration">([^<]+)<\/span>/i);
    const qualM = block.match(/class="video-(?:hd|sd)-mark">([^<]+)</i);
    const nameM = block.match(/<span class=['"]name['"]>([^<]+)<\/span>/i);

    if (eidM && urlM && thumbM && titleM) {
      videos.push({
        eid: eidM[1],
        url: 'https://www.xvideos.com' + urlM[1],
        thumb: thumbM[1],
        title: decodeHtml(titleM[1]),
        duration: durM ? decodeHtml(durM[1].trim()) : '',
        quality: qualM ? decodeHtml(qualM[1].trim()) : 'HD',
        uploader: nameM ? decodeHtml(nameM[1].trim()) : '',
      });
    }
  }

  return videos;
}
