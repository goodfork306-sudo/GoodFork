const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const bcrypt = require('bcryptjs');

async function redisSet(key, value) {
  await fetch(`${REDIS_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
  });
}

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

function generatePassword() {
  return Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
}

const ONE_OFF_PRODUCTS = ['kv4Q3'];
const TIER_CONFIG = {
  'RegUI': { max: 1,   seasonal: false, planType: 'trial' },
  'SUAdT': { max: 4,   seasonal: false, planType: 'monthly' },
  'Pi8aW': { max: 12,  seasonal: true,  planType: 'seasonal' },
  'SK0zB': { max: 52,  seasonal: true,  planType: 'yearly' },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { product_id, custom, customer_email } = req.body;

  // One-off purchase → mark session as paid
  if (ONE_OFF_PRODUCTS.includes(product_id) && custom) {
    await redisSet(`session:${custom}`, JSON.stringify({ status: 'paid' }), 3600);
    return res.status(200).json({ success: true });
  }

  // Tiered purchase → auto-create account
  if (TIER_CONFIG[product_id] && customer_email) {
    const config = TIER_CONFIG[product_id];
    const existing = await redisGet(`account:${customer_email}`);

    if (!existing) {
      const password = generatePassword();
      const hashedPassword = await bcrypt.hash(password, 10);
      const account = {
        email: customer_email,
        password: hashedPassword,
        remaining: config.max,
        max: config.max,
        seasonal: config.seasonal,
        created: Date.now(),
      };
      await redisSet(`account:${customer_email}`, JSON.stringify(account));
      // In production, send welcome email with temporary password here
      console.log(`Account created for ${customer_email}. Temp password: ${password}`);
    } else {
      // Add plans to existing account
      const account = typeof existing === 'string' ? JSON.parse(existing) : existing;
      account.remaining += config.max;
      account.max += config.max;
      await redisSet(`account:${customer_email}`, JSON.stringify(account));
    }
    return res.status(200).json({ success: true });
  }

  res.status(200).end();
};
