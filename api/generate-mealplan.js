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

For each meal use this format:
Name: [emoji] Short enticing phrase (X min | Difficulty | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: quantity ingredient, quantity ingredient
Steps: 1. Step 2. Step 3. Step
Healthy: One sentence. Allergens: X

Use these emojis for meals: Breakfast 🌅, Morning Snack 🍌, Lunch 🥗, Afternoon Snack 🥕, Dinner 🍽️

CRITICAL: Output all 7 days plus the JSON shopping list. Do not stop early.

=== Monday ===
🌅 Breakfast: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item
Steps: 1. Step 2. Step
Healthy: Sentence. Allergens: X

🍌 Morning Snack: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item
Steps: 1. Step
Healthy: Sentence. Allergens: X

🥗 Lunch: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item, qty item
Steps: 1. Step 2. Step 3. Step
Healthy: Sentence. Allergens: X

🥕 Afternoon Snack: Name (X min | Easy | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item
Steps: 1. Step
Healthy: Sentence. Allergens: X

🍽️ Dinner: Name (X min | Medium | X kcal | P: Xg | C: Xg | F: Xg)
Ingredients: qty item, qty item
Steps: 1. Step 2. Step 3. Step 4. Step
Healthy: Sentence. Allergens: X

Daily total: ~X kcal

(Repeat for all 7 days)

After the 7-day meal plan, output a categorised shopping list.
Start the shopping list with the line "=== SHOPPING_LIST_START ===" on its own.
Then, for each category, write a line with an emoji and the category name followed by a colon (e.g., "🥦 Fresh Produce:").
After that, list each item on its own line starting with "- ".
End the shopping list with the line "=== SHOPPING_LIST_END ===" on its own.

Example:
=== SHOPPING_LIST_START ===
🥦 Fresh Produce:
- 2 bananas
- 1 apple
- 1 bag spinach
🍗 Proteins:
- 200g chicken breast
- 4 eggs
🥛 Dairy & Alternatives:
- 1 litre milk
🍞 Grains & Breads:
- 1 loaf wholemeal bread
=== SHOPPING_LIST_END ===

DO NOT include any JSON, additional commentary, or meal plan text inside the markers.
DO NOT repeat the meal plan after the shopping list.

CATEGORY RULES:
- Fresh Produce: fruits, vegetables, salad greens, fresh herbs, avocado
- Proteins: meat, poultry, fish, seafood, eggs, biltong, tofu, tempeh
- Dairy & Alternatives: milk, cheese, yogurt, cream, butter, plant-based dairy
- Grains & Breads: rice, pasta, bread, wraps, tortillas, oats, cereal, flour, crackers, maize meal, pap
- Pantry & Condiments: oils, sauces, canned goods, honey, jam, hummus, vinegar, chakalaka
- Spices: all dried spices, seasonings, salt, pepper, curry powder
- Nuts & Seeds: all nuts, seeds, peanut butter, almond butter
- Other: anything that doesn't fit above

Multiply all quantities by {people}. Include every ingredient used in the meal plan. Do not skip any item.

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
