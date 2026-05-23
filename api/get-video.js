const { URL } = require('url');

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url: videoUrl, stream } = req.query;
    const isStream = stream === 'true';

    if (!videoUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }

    let urlObj;
    try {
        urlObj = new URL(videoUrl);
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    // ✅ Referer صح للـ CDN
    const fetchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://www.pornhub.com/',
        'Origin': 'https://www.pornhub.com',
        'Accept': '*/*',
    };

    // تمرير Range header
    if (req.headers['range']) {
        fetchHeaders['Range'] = req.headers['range'];
    }

    try {
        if (isStream) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 9000);

            let response;
            try {
                response = await fetch(videoUrl, {
                    headers: fetchHeaders,
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeout);
            }

            if (!response.ok) {
                return res.status(response.status).json({ 
                    error: `CDN returned ${response.status}` 
                });
            }

            const contentType = response.headers.get('content-type') || '';
            const isM3u8 = contentType.includes('mpegurl') || videoUrl.includes('.m3u8');

            if (isM3u8) {
                let text = await response.text();
                const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);

                const lines = text.split('\n').map(line => {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('#')) {
                        let absoluteUrl;
                        if (trimmed.startsWith('http')) {
                            absoluteUrl = trimmed;
                        } else if (trimmed.startsWith('/')) {
                            absoluteUrl = urlObj.origin + trimmed;
                        } else {
                            absoluteUrl = baseUrl + trimmed;
                        }
                        return `/api/get-video?stream=true&url=${encodeURIComponent(absoluteUrl)}`;
                    }
                    return line;
                });

                res.setHeader('Content-Type', 'application/x-mpegURL');
                res.setHeader('Cache-Control', 'no-cache');
                return res.status(200).send(lines.join('\n'));
            }

            // ✅ تحقق إن الرد مش HTML
            if (contentType.includes('text/html')) {
                return res.status(502).json({ 
                    error: 'CDN rejected - got HTML instead of video segment' 
                });
            }

            // إرسال الـ .ts segment
            const buffer = await response.arrayBuffer();
            res.setHeader('Content-Type', 'video/mp2t');
            res.setHeader('Cache-Control', 'no-cache');
            return res.status(200).send(Buffer.from(buffer));
        }

        // ========== جلب صفحة الفيديو ==========
        const response = await fetch(videoUrl, { headers: fetchHeaders });

        if (!response.ok) {
            return res.status(response.status).json({ 
                error: `Page fetch failed: ${response.status}` 
            });
        }

        const html = await response.text();

        let start = html.indexOf('"mediaDefinitions":');
        if (start === -1) {
            return res.status(404).json({ 
                error: 'mediaDefinitions not found in page' 
            });
        }

        start = html.indexOf('[', start);
        let count = 0, end = start;

        for (let i = start; i < html.length; i++) {
            if (html[i] === '[') count++;
            else if (html[i] === ']') {
                count--;
                if (count === 0) { end = i + 1; break; }
            }
        }

        const jsonStr = html.substring(start, end);
        const data = JSON.parse(jsonStr);

        // ✅ فلترة HLS فقط
        const processed = data
            .filter(item => item.format === 'hls' && item.videoUrl)
            .map(item => ({
                format: item.format,
                quality: item.quality || 'auto',
                videoUrl: Array.isArray(item.videoUrl) ? item.videoUrl[0] : item.videoUrl
            }))
            .filter(item => typeof item.videoUrl === 'string' && item.videoUrl.startsWith('http'));

        if (processed.length === 0) {
            return res.status(404).json({ error: 'No HLS streams found' });
        }

        return res.status(200).json(processed);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
