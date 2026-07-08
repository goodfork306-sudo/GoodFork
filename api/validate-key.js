const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { licenseKey } = req.body;
  if (!licenseKey) return res.status(400).json({ error: 'Missing licenseKey' });

  const data = await kv.get(`license:${licenseKey}`);
  if (!data) return res.status(404).json({ valid: false, error: 'Invalid license key' });

  return res.status(200).json({
    valid: true,
    remaining: data.remaining,
    max: data.max,
    seasonal: data.seasonal || false,
  });
};
