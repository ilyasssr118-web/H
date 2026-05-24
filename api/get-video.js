export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url: videoUrl, list, stream, search } = req.query;

  const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.xvideos.com/',
  };

  try {
    // ===== SEARCH / LIST =====
    if (list === 'true') {
      const targetUrl = videoUrl || 'https://www.xvideos.com/';
      const resp = await fetch(targetUrl, { headers: { ...BASE_HEADERS, Accept: 'text/html' } });
      if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });

      const html = await resp.text();
      const videos = parseVideos(html);

      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      return res.status(200).json({ videos });
    }

    // ===== GET STREAM URL =====
    if (!stream && videoUrl) {
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

    // ===== PROXY STREAM =====
    if (stream === 'true' && videoUrl) {
      const { URL: NodeURL } = require('url');
      const urlObj = new NodeURL(videoUrl);
      const streamHeaders = {
        ...BASE_HEADERS,
        Accept: '*/*',
        Origin: 'https://www.xvideos.com',
      };
      if (req.headers['range']) streamHeaders['Range'] = req.headers['range'];

      const proxyResp = await fetch(videoUrl, { headers: streamHeaders });
      const ct = proxyResp.headers.get('content-type') || '';

      if (ct.includes('mpegurl') || videoUrl.includes('.m3u8')) {
        const text = await proxyResp.text();
        const base = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);
        const rewritten = text.split('\n').map(line => {
          const t = line.trim();
          if (t && !t.startsWith('#')) {
            const abs = t.startsWith('http') ? t : t.startsWith('/') ? urlObj.origin + t : base + t;
            return `/api/get-video?stream=true&url=${encodeURIComponent(abs)}`;
          }
          return line;
        }).join('\n');
        res.setHeader('Content-Type', 'application/x-mpegURL');
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).send(rewritten);
      }

      const buf = await proxyResp.arrayBuffer();
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(Buffer.from(buf));
    }

    return res.status(400).json({ error: 'Invalid request' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
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
  // Match thumb-block divs
  const blockReg = /class="[^"]*thumb-block[^"]*"([\s\S]*?)(?=class="[^"]*thumb-block|<div id="ad-|<div class="pagination)/g;
  let bm;
  while ((bm = blockReg.exec(html)) !== null && videos.length < 32) {
    const block = bm[1];
    const eidM = block.match(/data-eid="([a-z0-9]+)"/);
    const urlM = block.match(/href="(\/video\.[^"?]+)"/);
    const thumbM = block.match(/data-src="(https?:\/\/[^"]+)"/);
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
