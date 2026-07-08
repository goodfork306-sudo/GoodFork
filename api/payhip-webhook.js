const { kv } = require('@vercel/kv');

// Single Plan (one‑off purchase — no license key, session‑based unlock)
const ONE_OFF_PRODUCTS = ['kv4Q3'];

// Tiered products (license keys with usage limits)
const TIER_CONFIG = {
  'RegUI': { max: 1,   seasonal: false },   // Trial
  'SUAdT': { max: 4,   seasonal: false },   // Monthly
  'Pi8aW': { max: 12,  seasonal: true  },   // Seasonal
  'SK0zB': { max: 52,  seasonal: true  },   // Yearly
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { product_id, license_key, custom } = req.body;

  // One‑off purchase → mark session as paid
  if (ONE_OFF_PRODUCTS.includes(product_id) && custom) {
    await kv.set(`session:${custom}`, { status: 'paid' }, { ex: 3600 }); // expires in 1 hour
    return res.status(200).json({ success: true });
  }

  // Tiered purchase → seed license key
  if (license_key && TIER_CONFIG[product_id]) {
    const config = TIER_CONFIG[product_id];
    await kv.set(`license:${license_key}`, {
      remaining: config.max,
      max: config.max,
      seasonal: config.seasonal,
    });
    return res.status(200).json({ success: true });
  }

  // Unknown product or missing data — ignore
  res.status(200).end();
};
