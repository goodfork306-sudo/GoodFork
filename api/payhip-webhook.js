const { kv } = require('@vercel/kv');

// Replace these with your actual Payhip product IDs
const ONE_OFF_PRODUCTS = ['ONE_OFF_ID_HERE'];
const TIER_CONFIG = {
  'TRIAL_ID_HERE':     { max: 1,   seasonal: false },
  'MONTHLY_ID_HERE':   { max: 4,   seasonal: false },
  'QUARTERLY_ID_HERE': { max: 12,  seasonal: true },
  'YEARLY_ID_HERE':    { max: 52,  seasonal: true },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { product_id, license_key, custom } = req.body;

  // One-off purchase → mark session as paid
  if (ONE_OFF_PRODUCTS.includes(product_id) && custom) {
    await kv.set(`session:${custom}`, { status: 'paid' }, { ex: 3600 });
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

  res.status(200).end();
};
