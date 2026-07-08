const Redis = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  try {
    await redis.set('test', 'ok');
    const value = await redis.get('test');
    res.status(200).json({ success: true, value, url: process.env.KV_REST_API_URL ? 'set' : 'missing' });
  } catch (error) {
    res.status(500).json({ error: error.message, url: process.env.KV_REST_API_URL ? 'set' : 'missing' });
  }
};
