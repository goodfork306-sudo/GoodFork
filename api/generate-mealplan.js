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

const SYSTEM_PROMPT = `Generate a complete 7-day meal plan (Monday through Sunday) for a {ageGroup} living in {country}. Dietary filters: {dietaryFilters}. Extra restrictions: {extraRestrictions}. For {people} people. {avoidMeals}

Rules:
- 5 meals per day: Breakfast, Morning Snack, Lunch, Afternoon Snack, Dinner
- Strictly respect all dietary filters and custom restrictions
- Use local ingredients and traditional dishes from {country}
- Adjust textures and portions for {ageGroup}
- No ultra-processed foods

For each meal use this compact format:
Name: Short enticing phrase (X min | Difficulty | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: quantity ingredient, quantity ingredient
Steps: 1. Step 2. Step 3. Step
Healthy: One sentence. Allergens: X

CRITICAL: Output all 7 days plus shopping list. Do not stop early.

=== Monday ===
Breakfast: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item
Steps: 1. Step 2. Step
Healthy: Sentence. Allergens: X

Morning Snack: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item
Steps: 1. Step
Healthy: Sentence. Allergens: X

Lunch: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item, qty item
Steps: 1. Step 2. Step 3. Step
Healthy: Sentence. Allergens: X

Afternoon Snack: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item
Steps: 1. Step
Healthy: Sentence. Allergens: X

Dinner: Name (X min | Medium | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item, qty item
Steps: 1. Step 2. Step 3. Step 4. Step
Healthy: Sentence. Allergens: X

Daily total: ~X kcal

=== Tuesday ===
[5 meals in same format]

=== Wednesday ===
[5 meals in same format]

=== Thursday ===
[5 meals in same format]

=== Friday ===
[5 meals in same format]

=== Saturday ===
[5 meals in same format]

=== Sunday ===
[5 meals in same format]

=== Shopping List ===
Fresh Produce: qty item, qty item
Proteins: qty item
Dairy: qty item
Grains: qty item
Pantry: qty item
Spices: qty item
Allergens: list

Multiply shopping quantities by {people}. Include every ingredient with exact quantities.

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

  account.remaining -= 1;
  await redisSet(`account:${email}`, JSON.stringify(account));

  const previousMeals = await redisSmembers(`history:${email}`);
  const avoidMeals = previousMeals.length > 0
    ? `Do NOT use these meals: ${previousMeals.join(', ')}. Create completely new meals.`
    : '';

  const randomWeek = Math.floor(Math.random() * 52) + 1;
  let seasonalInstructions = '';
  if (account.seasonal) {
    const season = getSeason(country, new Date().getMonth() + 1);
    seasonalInstructions = `Use seasonal ingredients for ${season} in ${country}.`;
  }

  let finalPrompt = SYSTEM_PROMPT
    .replace(/{country}/g, country)
    .replace(/{ageGroup}/g, ageGroup)
    .replace(/{dietaryFilters}/g, dietaryFilters || 'none')
    .replace(/{extraRestrictions}/g, extraRestrictions || '')
    .replace(/{people}/g, peopleCount)
    .replace(/{avoidMeals}/g, avoidMeals);

  finalPrompt = `${finalPrompt}\nRandom week: ${randomWeek}. ${seasonalInstructions}`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: finalPrompt },
        { role: 'user', content: 'Generate the full 7-day meal plan now.' }
      ],
      temperature: 0.7,
      max_tokens: 8000,
    });

    const mealPlan = completion.choices[0].message.content;

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
    account.remaining += 1;
    await redisSet(`account:${email}`, JSON.stringify(account));
    return res.status(500).json({ error: 'Generation failed. Plan count restored.' });
  }
};
