// netlify/functions/get-video.js
const { URL } = require('url');

exports.handler = async function (event, context) {
    // إعدادات CORS الشاملة لمنع أي رفض من المتصفح
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Origin, Accept, Range, Authorization",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "X-Content-Type-Options": "nosniff"
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    const videoUrl = event.queryStringParameters.url;
    const isStream = event.queryStringParameters.stream === "true";

    if (!videoUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing URL parameter" }) };
    }

    try {
        const urlObj = new URL(videoUrl);
        const originUrl = urlObj.origin + "/";

        // محاكاة متصفح متكاملة لتفادي أنظمة الحظر الذكية
        const fetchHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": originUrl,
            "Origin": originUrl,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        };

        if (isStream) {
            const response = await fetch(videoUrl, { headers: fetchHeaders });
            
            if (!response.ok) {
                return { statusCode: response.status, headers, body: `Original server responded with status ${response.status}` };
            }

            const contentType = response.headers.get("content-type") || "";

            // معالجة ملفات البث m3u8 بدقة متناهية
            if (contentType.includes("mpegurl") || contentType.includes("mpegURL") || videoUrl.includes(".m3u8")) {
                let text = await response.text();
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
                        lines[i] = `/.netlify/functions/get-video?stream=true&url=${encodeURIComponent(absoluteUrl)}`;
                    }
                }
                
                return {
                    statusCode: 200,
                    headers: { 
                        ...headers, 
                        "Content-Type": "application/x-mpegURL",
                        "Cache-Control": "no-store, no-cache, must-revalidate"
                    },
                    body: lines.join('\n')
                };
            }

            // تمرير قطع الفيديو .ts الثنائية كـ Base64 سريعة النقل
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

        // جلب صفحة الفيديو الأساسية لاستخراج الجودات (تحسين الأداء عبر الـ Regex)
        const response = await fetch(videoUrl, { headers: fetchHeaders });
        if (!response.ok) {
            return { statusCode: response.status, headers, body: JSON.stringify({ error: `Target site blocked the request with status ${response.status}` }) };
        }

        const html = await response.text();
        const regex = /"mediaDefinitions"\s*:\s*(\[\s*\{.*?\}\s*\])/s;
        const match = html.match(regex);

        if (!match) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: "Media definitions not found in HTML. Protect system upgraded." }) };
        }

        let data = JSON.parse(match[1]);
        return { statusCode: 200, headers, body: JSON.stringify(data) };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
