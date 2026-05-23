const { URL } = require('url');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url: videoUrl, stream } = req.query;
    const isStream = stream === 'true';

    if (!videoUrl) return res.status(400).json({ error: 'Missing URL' });

    let urlObj;
    try { urlObj = new URL(videoUrl); } 
    catch { return res.status(400).json({ error: 'Invalid URL' }); }

    const fetchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.pornhub.com/',
        'Origin': 'https://www.pornhub.com',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
    };

    if (req.headers['range']) fetchHeaders['Range'] = req.headers['range'];

    try {
        if (isStream) {
            // للـ stream headers مختلفة
            const streamHeaders = {
                'User-Agent': fetchHeaders['User-Agent'],
                'Referer': 'https://www.pornhub.com/',
                'Origin': 'https://www.pornhub.com',
                'Accept': '*/*',
            };
            if (req.headers['range']) streamHeaders['Range'] = req.headers['range'];

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 9000);
            let response;
            try {
                response = await fetch(videoUrl, { headers: streamHeaders, signal: controller.signal });
            } finally {
                clearTimeout(timeout);
            }

            if (!response.ok) return res.status(response.status).json({ error: `CDN error: ${response.status}` });

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                return res.status(502).json({ error: 'CDN rejected request' });
            }

            const isM3u8 = contentType.includes('mpegurl') || videoUrl.includes('.m3u8');
            if (isM3u8) {
                let text = await response.text();
                const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);
                const lines = text.split('\n').map(line => {
                    const t = line.trim();
                    if (t && !t.startsWith('#')) {
                        let abs = t.startsWith('http') ? t : t.startsWith('/') ? urlObj.origin + t : baseUrl + t;
                        return `/api/get-video?stream=true&url=${encodeURIComponent(abs)}`;
                    }
                    return line;
                });
                res.setHeader('Content-Type', 'application/x-mpegURL');
                res.setHeader('Cache-Control', 'no-cache');
                return res.status(200).send(lines.join('\n'));
            }

            const buffer = await response.arrayBuffer();
            res.setHeader('Content-Type', 'video/mp2t');
            res.setHeader('Cache-Control', 'no-cache');
            return res.status(200).send(Buffer.from(buffer));
        }

        // ===== جلب صفحة الفيديو =====
        const response = await fetch(videoUrl, { headers: fetchHeaders });
        if (!response.ok) return res.status(response.status).json({ error: `Fetch failed: ${response.status}` });

        const html = await response.text();

        // ✅ محاولة استخراج البيانات بعدة طرق
        let processed = [];

        // الطريقة 1: mediaDefinitions القديمة
        let start = html.indexOf('"mediaDefinitions":');
        if (start !== -1) {
            start = html.indexOf('[', start);
            let count = 0, end = start;
            for (let i = start; i < html.length; i++) {
                if (html[i] === '[') count++;
                else if (html[i] === ']') { count--; if (count === 0) { end = i + 1; break; } }
            }
            try {
                const data = JSON.parse(html.substring(start, end));
                processed = data
                    .filter(item => item.format === 'hls' && item.videoUrl)
                    .map(item => ({
                        format: 'hls',
                        quality: item.quality || 'auto',
                        videoUrl: Array.isArray(item.videoUrl) ? item.videoUrl[0] : item.videoUrl
                    }))
                    .filter(item => typeof item.videoUrl === 'string' && item.videoUrl.startsWith('http'));
            } catch(e) {}
        }

        // الطريقة 2: ابحث عن m3u8 مباشرة في الصفحة
        if (processed.length === 0) {
            const m3u8Regex = /https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g;
            const matches = html.match(m3u8Regex) || [];
            const unique = [...new Set(matches)];
            processed = unique.map((url, i) => ({
                format: 'hls',
                quality: 'stream_' + (i + 1),
                videoUrl: url
            }));
        }

        // الطريقة 3: ابحث عن flashvars أو playerObjList
        if (processed.length === 0) {
            const patterns = [
                /"quality_(\d+)p":"(https?[^"]+\.m3u8[^"]*)"/g,
                /quality_(\d+)p['":\s]+(https?[^"'\s]+\.m3u8)/g,
            ];
            for (const regex of patterns) {
                let match;
                while ((match = regex.exec(html)) !== null) {
                    processed.push({
                        format: 'hls',
                        quality: match[1],
                        videoUrl: match[2]
                    });
                }
                if (processed.length > 0) break;
            }
        }

        if (processed.length === 0) {
            // أرجع جزء من الـ HTML للتشخيص
            const snippet = html.substring(0, 500);
            return res.status(404).json({ 
                error: 'No streams found',
                debug: snippet
            });
        }

        return res.status(200).json(processed);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
