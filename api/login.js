const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const bcrypt = require('bcryptjs');

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

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const accountData = await redisGet(`account:${email}`);
  if (!accountData) return res.status(401).json({ error: 'Invalid email or password' });

  const account = typeof accountData === 'string' ? JSON.parse(accountData) : accountData;
  const valid = await bcrypt.compare(password, account.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  return res.status(200).json({
    email: account.email,
    remaining: account.remaining,
    max: account.max,
    seasonal: account.seasonal || false,
  });
};
