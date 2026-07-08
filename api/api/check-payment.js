const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { session } = req.query;
  if (!session) return res.status(400).json({ error: 'Missing session ID' });

  const data = await kv.get(`session:${session}`);
  const paid = data && data.status === 'paid';

  return res.status(200).json({ paid });
};
