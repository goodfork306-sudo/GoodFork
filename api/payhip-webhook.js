const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisSet(key, value, ttl) {
  const url = ttl
    ? `${REDIS_URL}/set/${key}?ex=${ttl}`
    : `${REDIS_URL}/set/${key}`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
  });
}

const ONE_OFF_PRODUCTS = ['kv4Q3'];
const TIER_CONFIG = {
  'RegUI': { max: 1,   seasonal: false },
  'SUAdT': { max: 4,   seasonal: false },
  'Pi8aW': { max: 12,  seasonal: true  },
  'SK0zB': { max: 52,  seasonal: true  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { product_id, license_key, custom } = req.body;

  if (ONE_OFF_PRODUCTS.includes(product_id) && custom) {
    await redisSet(`session:${custom}`, JSON.stringify({ status: 'paid' }), 3600);
    return res.status(200).json({ success: true });
  }

  if (license_key && TIER_CONFIG[product_id]) {
    const config = TIER_CONFIG[product_id];
    await redisSet(`license:${license_key}`, JSON.stringify({
      remaining: config.max,
      max: config.max,
      seasonal: config.seasonal,
    }));
    return res.status(200).json({ success: true });
  }

  res.status(200).end();
};
