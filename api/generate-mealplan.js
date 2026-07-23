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

const SYSTEM_PROMPT = `You are a professional paediatric and family nutritionist with deep knowledge of global cuisines. Generate a practical, healthy 7-day meal plan (Monday through Sunday) for a person living in {country} (if "Other" was selected and a custom country was typed, use that custom country instead). Age group: {ageGroup}. Dietary filters: {dietaryFilters}. Any additional restrictions: {extraRestrictions}. The plan is for {people} people.

CRITICAL: {avoidMeals}

Requirements:
- Each day must include: Breakfast, Morning Snack, Lunch, Afternoon Snack, Dinner.
- All meals must strictly respect every dietary restriction. If {dietaryFilters} includes "🥕 Vegetarian", exclude all meat, poultry, fish. If "🌱 Vegan", exclude all animal products (meat, dairy, eggs, honey). If "🕌 Halal", exclude pork and alcohol; use lamb, chicken, beef – user will source halal. If "🥛 Dairy-free", exclude all dairy and hidden dairy (casein, whey). If "🌾 Gluten-free", exclude wheat, barley, rye; use rice, maize, certified GF oats, buckwheat, quinoa. If "🥜 Nut-free", exclude peanuts and tree nuts; coconut is safe unless stated otherwise. If multiple filters are selected, honour all simultaneously.
- Additionally, follow exactly any custom restriction from "{extraRestrictions}". If empty, ignore.
- Use ingredients that are commonly available in the selected country (local markets, standard supermarkets).
- The meals must reflect the culinary traditions of that country.
- Adjust portion sizes and food textures precisely to {ageGroup}:
   * Infant (6-12 months): Only soft purees, mashed foods. No salt/sugar. No honey. No cow's milk as drink.
   * Toddler (1-3 years): Bite-sized, soft pieces. Avoid choking hazards.
   * Preschooler (4-6 years): Family-friendly meals, cut round foods lengthwise.
   * Child (7-12 years): Regular family meals, balanced.
   * Teen (13-17 years): Nutrient-dense, calcium- and iron-rich.
   * Adult (18-59 years): Balanced whole foods, lean protein, fibre.
   * Senior (60+ years): Easy-to-chew, nutrient-dense, lower sodium.
- Meals should be realistic for a busy family. No ultra-processed foods.

For EVERY meal line, append this metadata on the SAME line: "(⏱️ X min | 🧑‍🍳 Easy/Medium/Hard | 🔥 X kcal | P: Xg | C: Xg | F: Xg)".
After each day's dinner, add "Why it's healthy:" note.

Format exactly:
=== Monday ===
Breakfast: [description] (metadata)
Ingredients: [list with quantities]
Instructions: 1. [Step] 2. [Step] ...
Nutrition: 🔥 X kcal | P: Xg | C: Xg | F: Xg
Why it's healthy: [sentence]
Allergens: [list or None]
... (all meals)
Daily total: ~ XXXX kcal

=== Tuesday ===
...continue through Sunday. ALL 7 DAYS REQUIRED.

=== Shopping List ===

🥦 Fresh Produce
☐ quantity ingredient

🍗 Proteins
☐ quantity ingredient

🥛 Dairy and Alternatives
☐ quantity ingredient

🍞 Grains and Breads
☐ quantity ingredient

🧂 Pantry and Condiments
☐ quantity ingredient

🌿 Spices
☐ quantity ingredient

Allergen Summary: list all allergens across the week

Multiply all shopping list quantities by {people}.

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
      max_tokens: 4000,
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
