export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("No URL provided");
  }

  try {
    const response = await fetch(url);
    const data = await response.text();

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(data);
  } catch (error) {
    res.status(500).send("Error fetching URL");
  }
}
