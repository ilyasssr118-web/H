import axios from 'axios';

export default async function handler(req, res) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send('No URL');
    }

    console.log("URL:", url);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    console.log("Fetched OK");

    return res.status(200).json({
      length: response.data.length
    });

  } catch (err) {
    console.error("ERROR:", err.message);

    return res.status(500).send("Error: " + err.message);
  }
}
