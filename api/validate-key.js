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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { licenseKey } = req.body;
  if (!licenseKey) return res.status(400).json({ error: 'Missing licenseKey' });

  const data = await redisGet(`license:${licenseKey}`);
  if (!data) return res.status(404).json({ valid: false, error: 'Invalid license key' });

  const parsed = typeof data === 'string' ? JSON.parse(data) : data;

  return res.status(200).json({
    valid: true,
    remaining: parsed.remaining,
    max: parsed.max,
    seasonal: parsed.seasonal || false,
  });
};
