# StreamX Refactor

A cleaned-up version of the single-file StreamX player with:

- Removed inline handlers
- Event delegation for cards, sheets, and navigation
- Safer rendering for dynamic content
- Better search suggestion handling with abort support
- Improved HLS / MP4 switching logic
- Download endpoint streaming with attachment headers
- Stronger URL host allowlist and timeout handling

## Files

- `index.html` — layout
- `styles.css` — UI styling
- `js/app.js` — all client-side logic
- `api/get-video.js` — list, metadata, and stream proxy
- `api/download.js` — attachment download proxy

## Notes

- The download behavior depends on the server endpoint returning attachment headers.
- If you deploy to a serverless platform, make sure large video downloads are permitted.
- Keep the allowlist in the API files aligned with the hosts you actually trust.
