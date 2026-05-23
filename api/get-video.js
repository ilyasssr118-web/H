// api/get-video.js
const { URL } = require('url');

module.exports = async (req, res) => {
    // إعدادات CORS لتجنب أي مشاكل متصفح
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Origin, Accept, Range");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    const videoUrl = req.query.url;
    const isStream = req.query.stream === "true";

    if (!videoUrl) {
        return res.status(400).json({ error: "Missing URL parameter" });
    }

    try {
        const urlObj = new URL(videoUrl);
        const originUrl = urlObj.origin + "/";

        const fetchHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": originUrl,
            "Origin": originUrl,
            "Accept": "*/*"
        };

        if (isStream) {
            const response = await fetch(videoUrl, { headers: fetchHeaders });
            if (!response.ok) return res.status(response.status).send("Error fetching resource");

            const contentType = response.headers.get("content-type") || "";

            // معالجة ملفات الـ m3u8 وإصلاح مسارات قطع الـ ts بناءً على الصورة الثانية
            if (contentType.includes("mpegurl") || contentType.includes("mpegURL") || videoUrl.includes(".m3u8")) {
                let text = await response.text();
                // تحديد المسار الأبوي للرابط بدقة
                const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);
                let lines = text.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i].trim();
                    if (line && !line.startsWith('#')) {
                        let absoluteUrl;
                        if (line.startsWith('http')) {
                            absoluteUrl = line;
                        } else if (line.startsWith('/')) {
                            absoluteUrl = urlObj.origin + line;
                        } else {
                            // دمج المسار النسبي مثل seg-1-v1-a1.ts مع المسار الأبوي
                            absoluteUrl = baseUrl + line;
                        }
                        // تمرير القطعة عبر مسار فيرسيل الجديد /api/get-video
                        lines[i] = `/api/get-video?stream=true&url=${encodeURIComponent(absoluteUrl)}`;
                    }
                }
                
                res.setHeader("Content-Type", "application/x-mpegURL");
                res.setHeader("Cache-Control", "no-cache");
                return res.status(200).send(lines.join('\n'));
            }

            // تمرير قطع الـ .ts الثنائية
            const arrayBuffer = await response.arrayBuffer();
            res.setHeader("Content-Type", "video/mp2t");
            res.setHeader("Cache-Control", "public, max-age=3600");
            return res.status(200).send(Buffer.from(arrayBuffer));
        }

        // استخراج الجودات عبر الـ Regex السريع من الصفحة الأساسية
        const response = await fetch(videoUrl, { headers: fetchHeaders });
        const html = await response.text();
        const regex = /"mediaDefinitions"\s*:\s*(\[\s*\{.*?\}\s*\])/s;
        const match = html.match(regex);

        if (!match) {
            return res.status(404).json({ error: "Media not found. Protection might be updated." });
        }

        return res.status(200).json(JSON.parse(match[1]));

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
