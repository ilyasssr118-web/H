import axios from 'axios';
import * as cheerio from 'cheerio';

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

    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src) images.push(src);
    });

    $('video source').each((i, el) => {
      const src = $(el).attr('src');
      if (src) videos.push(src);
    });

    res.status(200).json({ images, videos });

  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
}
