const Redis = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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
    await redis.set(`session:${custom}`, JSON.stringify({ status: 'paid' }), { ex: 3600 });
    return res.status(200).json({ success: true });
  }

  if (license_key && TIER_CONFIG[product_id]) {
    const config = TIER_CONFIG[product_id];
    await redis.set(`license:${license_key}`, JSON.stringify({
      remaining: config.max,
      max: config.max,
      seasonal: config.seasonal,
    }));
    return res.status(200).json({ success: true });
  }

  res.status(200).end();
};
