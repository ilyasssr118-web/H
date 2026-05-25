import axios from 'axios';
import cheerio from 'cheerio';
import archiver from 'archiver';

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('No URL');
  }

  try {
    const page = await axios.get(url);
    const $ = cheerio.load(page.data);

    let files = [];

    // الصور
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('erome')) {
        files.push({ url: src, type: 'image' });
      }
    });

    // الفيديو
    $('source').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        files.push({ url: src, type: 'video' });
      }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=media.zip');

    const archive = archiver('zip');
    archive.pipe(res);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const response = await axios({
        url: file.url,
        method: 'GET',
        responseType: 'stream',
        headers: {
          'Referer': 'https://www.erome.com/',
          'User-Agent': 'Mozilla/5.0',
          'Range': 'bytes=0-' // 🔥 مهم للفيديو
        }
      });

      archive.append(response.data, {
        name: `${file.type}_${i}.${file.type === 'image' ? 'jpg' : 'mp4'}`
      });
    }

    await archive.finalize();

  } catch (err) {
    console.log(err);
    res.status(500).send('Error');
  }
}
