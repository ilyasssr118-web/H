const { URL } = require('url');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, Accept, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const videoUrl = req.query.url;
    const isStream = req.query.stream === 'true';

    if (!videoUrl) return res.status(400).json({ error: 'Missing url parameter' });

    try {
        const urlObj = new URL(videoUrl);

        // ✅ نفس منطق الكود القديم الشغال
        const fetchHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.pornhub.com/",
            "Origin": "https://www.pornhub.com",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        };

        if (req.headers['range']) fetchHeaders['Range'] = req.headers['range'];

        if (isStream) {
            const response = await fetch(videoUrl, { headers: fetchHeaders });
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('mpegurl') || contentType.includes('mpegURL') || videoUrl.includes('.m3u8')) {
                let text = await response.text();
                const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);
                let lines = text.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i].trim();
                    if (line && !line.startsWith('#')) {
                        let absoluteUrl = line.startsWith('http') ? line : 
                                         line.startsWith('/') ? urlObj.origin + line : 
                                         baseUrl + line;
                        lines[i] = `/api/get-video?stream=true&url=${encodeURIComponent(absoluteUrl)}`;
                    }
                }

                res.setHeader('Content-Type', 'application/x-mpegURL');
                res.setHeader('Cache-Control', 'no-cache');
                return res.status(200).send(lines.join('\n'));
            }

            // .ts segment
            const arrayBuffer = await response.arrayBuffer();
            res.setHeader('Content-Type', 'video/mp2t');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.status(200).send(Buffer.from(arrayBuffer));
        }

        // ===== جلب صفحة الفيديو =====
        const response = await fetch(videoUrl, { headers: fetchHeaders });
        const html = await response.text();

        let start = html.indexOf('"mediaDefinitions":');
        if (start === -1) {
            // ارجع اول 1000 حرف للتشخيص
            return res.status(404).json({ 
                error: 'mediaDefinitions not found',
                debug: html.substring(0, 1000)
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

        // فلترة HLS فقط
        const processed = data
            .filter(item => item.format === 'hls' && item.videoUrl)
            .map(item => ({
                format: item.format,
                quality: item.quality || 'auto',
                videoUrl: Array.isArray(item.videoUrl) ? item.videoUrl[0] : item.videoUrl
            }))
            .filter(item => typeof item.videoUrl === 'string');

        return res.status(200).json(processed);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
