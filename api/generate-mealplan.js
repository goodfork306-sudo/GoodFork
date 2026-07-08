const OpenAI = require('openai');
const { kv } = require('@vercel/kv');

// ============================================
// PASTE YOUR ENTIRE SYSTEM PROMPT HERE
// Include the following rules:
// - Multiply all shopping list quantities by {people}
// - Add disclaimer at the end: "⚠️ Disclaimer: This meal plan is for informational purposes only..."
// ============================================
const SYSTEM_PROMPT = `...`; // YOUR PROMPT + scaling + disclaimer

function getSeason(country, month) {
  const southern = ['South Africa', 'Nigeria', 'Kenya', 'Australia'];
  const isSouthern = southern.includes(country);
  if (isSouthern) {
    if ([12,1,2].includes(month)) return 'Summer';
    if ([3,4,5].includes(month)) return 'Autumn';
    if ([6,7,8].includes(month)) return 'Winter';
    return 'Spring';
  } else {
    if ([12,1,2].includes(month)) return 'Winter';
    if ([3,4,5].includes(month)) return 'Spring';
    if ([6,7,8].includes(month)) return 'Summer';
    return 'Autumn';
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { country, ageGroup, dietaryFilters, extraRestrictions, licenseKey, people } = req.body;
  const peopleCount = people || 1;

  // License validation
  if (!licenseKey) return res.status(401).json({ error: 'License key required' });
  const licenseData = await kv.get(`license:${licenseKey}`);
  if (!licenseData) return res.status(403).json({ error: 'Invalid license key' });
  if (licenseData.remaining <= 0) return res.status(403).json({ error: 'Usage limit reached' });

  // Deduct usage
  await kv.set(`license:${licenseKey}`, {
    remaining: licenseData.remaining - 1,
    max: licenseData.max,
    seasonal: licenseData.seasonal,
  });

  // Variety and seasonal instructions
  const randomWeek = Math.floor(Math.random() * 52) + 1;
  const varietyInstructions = `This is a unique plan. Random week: ${randomWeek}. Do not repeat typical defaults.`;

  let seasonalInstructions = '';
  if (licenseData.seasonal) {
    const currentMonth = new Date().getMonth() + 1;
    const season = getSeason(country, currentMonth);
    seasonalInstructions = `The meal plan must be strictly seasonal for ${season} in ${country}. Use seasonal produce and appropriate dishes.`;
  }

  let finalPrompt = SYSTEM_PROMPT
    .replace(/{country}/g, country)
    .replace(/{ageGroup}/g, ageGroup)
    .replace(/{dietaryFilters}/g, dietaryFilters || 'none')
    .replace(/{extraRestrictions}/g, extraRestrictions || '')
    .replace(/{people}/g, peopleCount);

  finalPrompt = `${finalPrompt}\n${varietyInstructions}\n${seasonalInstructions}`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: finalPrompt },
        { role: 'user', content: 'Please generate the meal plan.' }
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });
    const mealPlan = completion.choices[0].message.content;
    return res.status(200).json({ mealPlan });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
