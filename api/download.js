import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
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

  if (req.headers['range']) headers['Range'] = req.headers['range'];

  try {
    const proxyResp = await fetch(videoUrl, { headers });
    if (!proxyResp.ok) {
      return res.status(proxyResp.status).json({ error: `Upstream HTTP ${proxyResp.status}` });
    }

    const filename = sanitizeFilename(name || 'video') + '.mp4';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');

    const contentType = proxyResp.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    const contentLength = proxyResp.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = proxyResp.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.status(206);
    }

    const acceptRanges = proxyResp.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    if (!proxyResp.body) return res.end();
    await pipeline(Readable.fromWeb(proxyResp.body), res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function sanitizeFilename(input) {
  return String(input)
    .replace(/[^a-zA-Z0-9_ -]/g, '')
    .trim()
    .slice(0, 80) || 'video';
}
