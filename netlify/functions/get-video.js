// netlify/functions/get-video.js
const { URL } = require('url');

exports.handler = async function (event, context) {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Origin, Accept, Range",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    const videoUrl = event.queryStringParameters.url;
    const isStream = event.queryStringParameters.stream === "true";

    if (!videoUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url parameter" }) };
    }

    try {
        const urlObj = new URL(videoUrl);
        const originUrl = urlObj.origin + "/";

        const fetchHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": originUrl,
            "Origin": originUrl
        };

        if (isStream) {
            const response = await fetch(videoUrl, { headers: fetchHeaders });
            const contentType = response.headers.get("content-type") || "";

            // معالجة ملفات المانيفست m3u8 وإصلاح الروابط النسبية بدقة
            if (contentType.includes("mpegurl") || contentType.includes("mpegURL") || videoUrl.includes(".m3u8")) {
                let text = await response.text();
                
                // تحديد المسار الأساسي الصحيح لبناء الروابط
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
                            absoluteUrl = baseUrl + line;
                        }
                        // إعادة توجيه القطعة عبر البروكسي بأمان
                        lines[i] = `/.netlify/functions/get-video?stream=true&url=${encodeURIComponent(absoluteUrl)}`;
                    }
                }
                
                return {
                    statusCode: 200,
                    headers: { 
                        ...headers, 
                        "Content-Type": "application/x-mpegURL",
                        "Cache-Control": "no-cache"
                    },
                    body: lines.join('\n')
                };
            }

            // تمرير قطع الفيديو الثنائية (.ts) كـ Base64 بسرعة فائقة
            const arrayBuffer = await response.arrayBuffer();
            return {
                statusCode: 200,
                headers: { 
                    ...headers, 
                    "Content-Type": "video/mp2t",
                    "Cache-Control": "public, max-age=3600" 
                },
                body: Buffer.from(arrayBuffer).toString("base64"),
                isBase64Encoded: true
            };
        }

        // جلب صفحة الفيديو الأساسية لاستخراج الجودات
        const response = await fetch(videoUrl, { headers: fetchHeaders });
        const html = await response.text();

        let start = html.indexOf('"mediaDefinitions":');
        if (start === -1) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: "Media not found" }) };
        }
        
        start = html.indexOf('[', start);
        let count = 0, end = start;

        for (let i = start; i < html.length; i++) {
            if (html[i] == '[') count++;
            else if (html[i] == ']') {
                count--;
                if (count == 0) { end = i + 1; break; }
            }
        }

        let jsonStr = html.substring(start, end);
        let data = JSON.parse(jsonStr);

        return { statusCode: 200, headers, body: JSON.stringify(data) };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
