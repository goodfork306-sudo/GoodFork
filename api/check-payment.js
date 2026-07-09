const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { session } = req.query;
  if (!session) return res.status(400).json({ error: 'Missing session ID' });

  const data = await redisGet(`session:${session}`);
  const paid = data && (typeof data === 'string' ? JSON.parse(data) : data).status === 'paid';

  return res.status(200).json({ paid });
};
