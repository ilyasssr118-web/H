export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url: videoUrl, list, stream, search } = req.query;

  const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.xvideos.com/',
  };

  try {
    if (list === 'true') {
      const targetUrl = videoUrl || 'https://www.xvideos.com/';
      assertAllowedUrl(targetUrl);
      const resp = await fetch(targetUrl, { headers: { ...BASE_HEADERS, Accept: 'text/html' } });
      if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });

      const html = await resp.text();
      const videos = parseVideos(html);
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.status(200).json({ videos });
    }

    if (!stream && videoUrl) {
      assertAllowedUrl(videoUrl);
      const resp = await fetch(videoUrl, { headers: { ...BASE_HEADERS, Accept: 'text/html' } });
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
      const urlObj = new URL(videoUrl);
      const streamHeaders = {
        ...BASE_HEADERS,
        Accept: '*/*',
        Origin: 'https://www.xvideos.com',
      };
      if (req.headers['range']) streamHeaders['Range'] = req.headers['range'];

      const proxyResp = await fetch(videoUrl, { headers: streamHeaders });
      if (!proxyResp.ok) return res.status(proxyResp.status).json({ error: `Upstream HTTP ${proxyResp.status}` });

      const ct = proxyResp.headers.get('content-type') || '';
      const isPlaylist = ct.includes('mpegurl') || videoUrl.includes('.m3u8');
      setPassThroughHeaders(res, proxyResp, isPlaylist ? 'application/vnd.apple.mpegurl' : ct || 'application/octet-stream');

      if (isPlaylist) {
        const text = await proxyResp.text();
        const base = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);
        const rewritten = rewritePlaylist(text, base, urlObj.origin);
        return res.status(200).send(rewritten);
      }

      const buf = Buffer.from(await proxyResp.arrayBuffer());
      return res.status(proxyResp.status === 206 ? 206 : 200).send(buf);
    }

    return res.status(400).json({ error: 'Invalid request' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function setPassThroughHeaders(res, upstream, contentType) {
  res.setHeader('Content-Type', contentType);
  const headers = ['content-length', 'content-range', 'accept-ranges', 'cache-control'];
  for (const key of headers) {
    const val = upstream.headers.get(key);
    if (val) res.setHeader(key === 'content-length' ? 'Content-Length' : key === 'content-range' ? 'Content-Range' : key === 'accept-ranges' ? 'Accept-Ranges' : 'Cache-Control', val);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function rewritePlaylist(text, base, origin) {
  return text.split('\n').map(line => {
    const t = line.trim();
    if (t && !t.startsWith('#')) {
      const abs = t.startsWith('http') ? t : t.startsWith('/') ? origin + t : base + t;
      return `/api/get-video?stream=true&url=${encodeURIComponent(abs)}`;
    }
    return line;
  }).join('\n');
}

function assertAllowedUrl(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowed = [
    'xvideos.com',
    'www.xvideos.com',
    'xvideos-cdn.com',
    'www.xvideos-cdn.com',
  ];
  if (!allowed.some(d => host === d || host.endsWith(`.${d}`))) {
    throw new Error('Blocked URL host');
  }
}

function decodeHtml(s) {
  return s.replace(/&#039;/g,"'").replace(/&amp;/g,'&').replace(/&quot;/g,'"')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&ldquo;/g,'"')
    .replace(/&rdquo;/g,'"').replace(/&rsquo;/g,"'").replace(/&comma;/g,',')
    .replace(/&period;/g,'.').replace(/&lsquo;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&hellip;/g,'...');
}

function parseVideos(html) {
  const videos = [];
  const blockReg = /class="[^"]*thumb-block[^"]*"([\s\S]*?)(?=class="[^"]*thumb-block|<div id="ad-|<div class="pagination)/g;
  let bm;
  while ((bm = blockReg.exec(html)) !== null && videos.length < 32) {
    const block = bm[1];
    const eidM = block.match(/data-eid="([a-z0-9]+)"/);
    const urlM = block.match(/href="(\/video\.[^"?]+)"/);
    const thumbM = block.match(/data-src="(https?:\/\/[^\"]+)"/);
    const titleM = block.match(/title="([^"]{5,200})"/);
    const durM = block.match(/<span class="duration">([^<]+)<\/span>/);
    const qualM = block.match(/class="video-(?:hd|sd)-mark">([^<]+)</);
    const nameM = block.match(/<span class=['"]name['"]>([^<]+)<\/span>/);

    if (eidM && urlM && thumbM && titleM) {
      videos.push({
        eid: eidM[1],
        url: 'https://www.xvideos.com' + urlM[1],
        thumb: thumbM[1],
        title: decodeHtml(titleM[1]),
        duration: durM ? durM[1].trim() : '',
        quality: qualM ? qualM[1].trim() : 'HD',
        uploader: nameM ? decodeHtml(nameM[1].trim()) : '',
      });
    }
  }
  return videos;
}
