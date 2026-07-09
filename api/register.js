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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, planType } = req.body; // planType: 'trial', 'monthly', 'seasonal', 'yearly'

  if (!email) return res.status(400).json({ error: 'Email required' });

  const existing = await redisGet(`account:${email}`);
  if (existing) {
    return res.status(200).json({ message: 'Account already exists', email });
  }

  const password = generatePassword();
  const hashedPassword = await bcrypt.hash(password, 10);

  const planLimits = {
    trial: 1,
    monthly: 4,
    seasonal: 12,
    yearly: 52,
  };

  const account = {
    email,
    password: hashedPassword,
    remaining: planLimits[planType] || 1,
    max: planLimits[planType] || 1,
    seasonal: planType === 'seasonal' || planType === 'yearly',
    created: Date.now(),
  };

  await redisSet(`account:${email}`, JSON.stringify(account));

  return res.status(200).json({
    message: 'Account created',
    email,
    temporaryPassword: password, // In production, email this instead
  });
};
