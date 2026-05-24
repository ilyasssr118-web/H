# StreamX refactor

This package splits the app into:

- `index.html`
- `styles.css`
- `js/app.js`
- `api/get-video.js`
- `api/download.js`

## Notes

- The frontend keeps the custom player and mobile quality sheet.
- `api/download.js` streams downloads and returns `Content-Disposition: attachment`.
- `api/get-video.js` validates upstream hosts and proxies HLS playlists.
- Search suggestion requests now use an abortable controller to prevent stale results.
- Text inserted into the UI is escaped before rendering.

## Usage

Place these files in a Next.js-style project structure, or adapt the API handlers to your serverless setup.
