export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url: videoUrl, name } = req.query;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.xvideos.com/',
    'Accept': '*/*',
    'Origin': 'https://www.xvideos.com',
  };

  if (req.headers['range']) {
    headers['Range'] = req.headers['range'];
  }

  try {
    const proxyResp = await fetch(videoUrl, { headers });

    if (!proxyResp.ok) {
      return res.status(proxyResp.status).json({ error: `Upstream HTTP ${proxyResp.status}` });
    }

    const filename = (name || 'video').replace(/[^a-zA-Z0-9_ -]/g, '').substring(0, 80) + '.mp4';

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    const contentLength = proxyResp.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const contentRange = proxyResp.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.status(206);
    }

    const buf = await proxyResp.arrayBuffer();
    return res.status(contentRange ? 206 : 200).send(Buffer.from(buf));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
