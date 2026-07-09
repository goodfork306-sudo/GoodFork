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

const SYSTEM_PROMPT = `You are a professional paediatric and family nutritionist with deep knowledge of global cuisines. Generate a practical, healthy 7-day meal plan (Monday through Sunday) for a person living in {country} (if "Other" was selected and a custom country was typed, use that custom country instead). Age group: {ageGroup}. Dietary filters: {dietaryFilters}. Any additional restrictions: {extraRestrictions}. The plan is for {people} people.

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

=== Shopping List ===
🥦 Fresh Produce
☐ quantity ingredient
🍗 Proteins
☐ quantity ingredient
🥛 Dairy & Alternatives
☐ quantity ingredient
🍞 Grains & Breads
☐ quantity ingredient
🧂 Pantry & Condiments
☐ quantity ingredient
🌿 Spices
☐ quantity ingredient
Allergen Summary: [list]

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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { country, ageGroup, dietaryFilters, extraRestrictions, licenseKey, people } = req.body;
  const peopleCount = people || 1;

  if (!licenseKey) return res.status(401).json({ error: 'License key required' });
  const licenseData = await redisGet(`license:${licenseKey}`);
  if (!licenseData) return res.status(403).json({ error: 'Invalid license key' });
  const parsed = typeof licenseData === 'string' ? JSON.parse(licenseData) : licenseData;
  if (parsed.remaining <= 0) return res.status(403).json({ error: 'Usage limit reached' });

  await redisSet(`license:${licenseKey}`, JSON.stringify({
    remaining: parsed.remaining - 1,
    max: parsed.max,
    seasonal: parsed.seasonal,
  }));

  const randomWeek = Math.floor(Math.random() * 52) + 1;
  const varietyInstructions = `This is a unique plan. Random week: ${randomWeek}.`;

  let seasonalInstructions = '';
  if (parsed.seasonal) {
    const season = getSeason(country, new Date().getMonth() + 1);
    seasonalInstructions = `Strictly seasonal for ${season} in ${country}.`;
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
    return res.status(200).json({ mealPlan: completion.choices[0].message.content });
    } catch (error) {
    console.error('OpenAI error:', error);
    return res.status(500).json({ 
      error: 'Generation failed', 
      message: error.message,
      type: error.type,
      code: error.code 
    });
  }
};
