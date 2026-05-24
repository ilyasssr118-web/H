const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.xvideos.com/',
  'Accept': '*/*',
  'Origin': 'https://www.xvideos.com',
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

  const { url: videoUrl, name } = req.query;
  if (!videoUrl) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    assertAllowedUrl(videoUrl);
    const upstream = await fetchWithTimeout(videoUrl, {
      headers: buildHeaders(req),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream HTTP ${upstream.status}` });
    }

    const filename = buildAttachmentFilename(name || 'video');
    const disposition = `attachment; filename="${filename.ascii}"; filename*=UTF-8''${filename.utf8}`;

    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = upstream.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.status(206);
    }

    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    const etag = upstream.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);
    const lastModified = upstream.headers.get('last-modified');
    if (lastModified) res.setHeader('Last-Modified', lastModified);

    if (!upstream.body) return res.end();
    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    res.status(upstream.status === 206 ? 206 : 200);
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function buildHeaders(req) {
  const headers = { ...BASE_HEADERS };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
  if (req.headers['if-modified-since']) headers['If-Modified-Since'] = req.headers['if-modified-since'];
  return headers;
}

function buildAttachmentFilename(input) {
  const ascii = String(input)
    .replace(/[^a-zA-Z0-9_ -]/g, '')
    .trim()
    .slice(0, 80) || 'video';
  const utf8 = encodeRFC5987(`${ascii}.mp4`);
  return { ascii: `${ascii}.mp4`, utf8 };
}

function encodeRFC5987(value) {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (match) => match.toLowerCase());
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
