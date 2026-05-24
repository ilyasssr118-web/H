const { URL } = require('url');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url: videoUrl, list, stream } = req.query;
  if (!videoUrl) return res.status(400).json({ error: 'Missing url' });

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.xvideos.com/',
  };

  try {
    // ===== جلب قائمة فيديوهات من صفحة =====
    if (list === 'true') {
      const resp = await fetch(videoUrl, { headers: fetchHeaders });
      if (!resp.ok) return res.status(resp.status).json({ error: `Fetch failed: ${resp.status}` });
      const html = await resp.text();

      // استخراج الفيديوهات من thumb-block
      const videos = [];
      const regex = /id="video_([a-z0-9]+)"[^>]*>.*?href="(\/video\.[^"]+)".*?data-src="([^"]+)".*?class="video-[^"]*-mark">([^<]+)<.*?<p class="title">.*?title="([^"]+)".*?<span class="duration">([^<]+)<.*?<span class='name'>([^<]+)<\/span>/gs;
      
      let match;
      while ((match = regex.exec(html)) !== null && videos.length < 30) {
        videos.push({
          eid: match[1],
          url: 'https://www.xvideos.com' + match[2],
          thumb: match[3],
          quality: match[4],
          title: match[5].replace(/&#039;/g,"'").replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&ldquo;/g,'"').replace(/&rdquo;/g,'"').replace(/&rsquo;/g,"'").replace(/&comma;/g,',').replace(/&period;/g,'.').replace(/&lsquo;/g,"'"),
          duration: match[6],
          uploader: match[7],
        });
      }

      // fallback regex أبسط لو الأول ما اشتغل
      if (videos.length === 0) {
        const r2 = /data-eid="([a-z0-9]+)"[^>]*>.*?href="(\/video\.[^"]+)".*?data-src="([^"]+)".*?title="([^"]+)".*?<span class="duration">([^<]+)<\/span>/gs;
        while ((match = r2.exec(html)) !== null && videos.length < 30) {
          videos.push({
            eid: match[1],
            url: 'https://www.xvideos.com' + match[2],
            thumb: match[3],
            title: match[4].replace(/&#039;/g,"'").replace(/&amp;/g,'&').replace(/&quot;/g,'"'),
            duration: match[5],
            quality: '720p',
            uploader: '',
          });
        }
      }

      return res.status(200).json({ videos, pageUrl: videoUrl });
    }

    // ===== جلب HLS لفيديو معين =====
    if (stream !== 'true') {
      const resp = await fetch(videoUrl, { headers: fetchHeaders });
      if (!resp.ok) return res.status(resp.status).json({ error: `Fetch failed: ${resp.status}` });
      const html = await resp.text();

      // استخراج HLS
      const hlsMatch = html.match(/setVideoHLS\('([^']+)'\)/);
      const mp4High = html.match(/setVideoUrlHigh\('([^']+)'\)/);
      const mp4Low = html.match(/setVideoUrlLow\('([^']+)'\)/);
      const titleMatch = html.match(/setVideoTitle\('([^']+)'\)/);
      const thumbMatch = html.match(/setThumbUrl169\('([^']+)'\)/);

      if (!hlsMatch && !mp4High) {
        return res.status(404).json({ error: 'No stream found' });
      }

      return res.status(200).json({
        hls: hlsMatch ? hlsMatch[1] : null,
        mp4high: mp4High ? mp4High[1] : null,
        mp4low: mp4Low ? mp4Low[1] : null,
        title: titleMatch ? titleMatch[1].replace(/&amp;/g,'&').replace(/&#039;/g,"'") : '',
        thumb: thumbMatch ? thumbMatch[1] : '',
      });
    }

    // ===== Proxy stream =====
    const urlObj = new URL(videoUrl);
    const streamHeaders = {
      'User-Agent': fetchHeaders['User-Agent'],
      'Referer': 'https://www.xvideos.com/',
      'Origin': 'https://www.xvideos.com',
      'Accept': '*/*',
    };
    if (req.headers['range']) streamHeaders['Range'] = req.headers['range'];

    const resp = await fetch(videoUrl, { headers: streamHeaders });
    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('mpegurl') || videoUrl.includes('.m3u8')) {
      let text = await resp.text();
      const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);
      const lines = text.split('\n').map(line => {
        const t = line.trim();
        if (t && !t.startsWith('#')) {
          const abs = t.startsWith('http') ? t : t.startsWith('/') ? urlObj.origin + t : baseUrl + t;
          return `/api/get-video?stream=true&url=${encodeURIComponent(abs)}`;
        }
        return line;
      });
      res.setHeader('Content-Type', 'application/x-mpegURL');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(lines.join('\n'));
    }

    const buffer = await resp.arrayBuffer();
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
