const Redis = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { session } = req.query;
  if (!session) return res.status(400).json({ error: 'Missing session ID' });

  const data = await redis.get(`session:${session}`);
  const paid = data && (typeof data === 'string' ? JSON.parse(data) : data).status === 'paid';

  return res.status(200).json({ paid });
};
