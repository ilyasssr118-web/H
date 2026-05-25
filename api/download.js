import axios from 'axios';
import cheerio from 'cheerio';

export default async function handler(req, res) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send('No URL');
    }

    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.erome.com/'
      }
    });

    const $ = cheerio.load(data);

    let images = [];
    let videos = [];

    // صور
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('media')) {
        images.push(src);
      }
    });

    // فيديو
    $('video source').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        videos.push(src);
      }
    });

    return res.status(200).json({
      images,
      videos
    });

  } catch (err) {
    console.error(err);
    return res.status(500).send(err.message);
  }
}
