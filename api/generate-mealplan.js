const OpenAI = require('openai');

const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

async function redisSet(key, value) {
  await fetch(`${REDIS_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
  });
}

async function redisSadd(key, value) {
  await fetch(`${REDIS_URL}/sadd/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
  });
}

async function redisSmembers(key) {
  const res = await fetch(`${REDIS_URL}/smembers/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const data = await res.json();
  return data.result || [];
}

const SYSTEM_PROMPT = `Generate a FULL 7-day meal plan (Mon-Sun) for {people} {ageGroup} in {country}. Diets: {dietaryFilters}. Extra: {extraRestrictions}. {avoidMeals}

Rules: Respect all diets. Use local {country} ingredients. Age-appropriate portions. No processed foods.

Per meal format (keep each meal to 4-5 lines total):
Name: Short enticing phrase (TIME | DIFFICULTY | CAL kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item, qty item
Steps: 1. Step 2. Step 3. Step
Healthy: One sentence. Allergens: X

CRITICAL: You MUST output all 7 days (Mon-Sun) plus shopping list. Do not stop early.

=== Mon ===
Breakfast: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item
Steps: 1. Step 2. Step
Healthy: Sentence. Allergens: X

Morning Snack: ... (same format)
Lunch: ...
Afternoon Snack: ...
Dinner: ...
Daily total: ~X kcal

=== Tue === [...all 5 meals...]
=== Wed === [...all 5 meals...]
=== Thu === [...all 5 meals...]
=== Fri === [...all 5 meals...]
=== Sat === [...all 5 meals...]
=== Sun === [...all 5 meals...]

=== Shopping List ===
Produce: qty item, qty item
Proteins: qty item
Dairy: qty item
Grains: qty item
Pantry: qty item
Spices: qty item
Allergens: list

Multiply quantities by {people}. Include every ingredient.

⚠️ Disclaimer: This meal plan is for informational purposes only and does not replace professional medical or dietary advice.`;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { country, ageGroup, dietaryFilters, extraRestrictions, email, people } = req.body;
  const peopleCount = people || 1;

  if (!email) return res.status(401).json({ error: 'Login required' });
  const accountData = await redisGet(`account:${email}`);
  if (!accountData) return res.status(403).json({ error: 'Account not found' });
  const account = typeof accountData === 'string' ? JSON.parse(accountData) : accountData;
  if (account.remaining <= 0) return res.status(403).json({ error: 'Usage limit reached' });

  // Deduct usage
  account.remaining -= 1;
  await redisSet(`account:${email}`, JSON.stringify(account));

  // Get previously generated meal names to avoid
  const previousMeals = await redisSmembers(`history:${email}`);
  const avoidMeals = previousMeals.length > 0
    ? `You must NOT use any of these meals that were already generated for this customer: ${previousMeals.join(', ')}. Create entirely new, different meals.`
    : '';

  // Variety and seasonal instructions
  const randomWeek = Math.floor(Math.random() * 52) + 1;
  const varietyInstructions = `This is a unique plan. Random week: ${randomWeek}.`;

  let seasonalInstructions = '';
  if (account.seasonal) {
    const season = getSeason(country, new Date().getMonth() + 1);
    seasonalInstructions = `Strictly seasonal for ${season} in ${country}.`;
  }

  let finalPrompt = SYSTEM_PROMPT
    .replace(/{country}/g, country)
    .replace(/{ageGroup}/g, ageGroup)
    .replace(/{dietaryFilters}/g, dietaryFilters || 'none')
    .replace(/{extraRestrictions}/g, extraRestrictions || '')
    .replace(/{people}/g, peopleCount)
    .replace(/{avoidMeals}/g, avoidMeals);

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
      max_tokens: 8000,
    });

    const mealPlan = completion.choices[0].message.content;

    // Extract meal names and store in history
    const mealNames = [];
    const lines = mealPlan.split('\n');
    for (const line of lines) {
      if (line.startsWith('Breakfast:') || line.startsWith('Morning Snack:') || 
          line.startsWith('Lunch:') || line.startsWith('Afternoon Snack:') || 
          line.startsWith('Dinner:')) {
        const name = line.split(':')[1]?.split('(')[0]?.trim();
        if (name) mealNames.push(name);
      }
    }

    for (const name of mealNames) {
      await redisSadd(`history:${email}`, name);
    }

    return res.status(200).json({
      mealPlan,
      remaining: account.remaining,
      max: account.max,
    });
  } catch (error) {
    // Refund the deducted use if generation fails
    account.remaining += 1;
    await redisSet(`account:${email}`, JSON.stringify(account));
    return res.status(500).json({ error: 'Generation failed. Your plan count has been restored.' });
  }
};
