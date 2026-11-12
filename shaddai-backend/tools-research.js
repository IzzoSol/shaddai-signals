/* ══════════════════════════════════════════════════════════════════
   tools-research.js — REAL research/knowledge tools (ORACLE). Keyless
   public APIs: OpenLibrary, DictionaryAPI, Quotable, NumbersAPI,
   AdviceSlip, Nager holidays, USGS quakes, ISS, Genderize/Agify/
   Nationalize, Datamuse, TVMaze, OpenFoodFacts, Universities,
   Open-Meteo, Wikipedia on-this-day. Every executor fetches live data.
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const ok = (o) => JSON.stringify(o);
const err = (e) => JSON.stringify({ error: (e && e.message) || String(e) });
async function gj(url, opts) { const r = await fetch(url, Object.assign({ headers: { 'user-agent': 'SHADDAI/1.0' } }, opts || {})); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
function tool(name, desc, schema, agents, fn) { return { name, description: desc, schema: schema || {}, agents: agents || ['ORACLE', 'SHADDAI'], category: 'Research & Knowledge', async execute(p = {}) { try { return await fn(p || {}); } catch (e) { return err(e); } } }; }
const R = ['ORACLE', 'SHADDAI', 'QUILL'];
const TOOLS_RESEARCH = {};
const reg = (t) => { TOOLS_RESEARCH[t.name] = t; };

reg(tool('book_search', 'Search books by title/author/subject (OpenLibrary).', { query: 'string' }, R, async (p) => {
  const d = await gj('https://openlibrary.org/search.json?limit=6&q=' + encodeURIComponent(p.query || 'dune'));
  return ok({ query: p.query, results: (d.docs || []).slice(0, 6).map((b) => ({ title: b.title, author: (b.author_name || [])[0], year: b.first_publish_year, editions: b.edition_count })) });
}));
reg(tool('define_word', 'Dictionary definition, phonetics, examples (DictionaryAPI).', { word: 'string' }, R, async (p) => {
  const w = String(p.word || 'serendipity').toLowerCase();
  const d = await gj('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w));
  const e = d[0]; const defs = (e.meanings || []).slice(0, 3).map((m) => ({ partOfSpeech: m.partOfSpeech, definition: m.definitions[0].definition, example: m.definitions[0].example }));
  return ok({ word: w, phonetic: e.phonetic, definitions: defs });
}));
reg(tool('related_words', 'Find words related in meaning to a word (Datamuse).', { word: 'string' }, R, async (p) => {
  const d = await gj('https://api.datamuse.com/words?max=15&ml=' + encodeURIComponent(p.word || 'ocean'));
  return ok({ word: p.word, related: d.map((x) => x.word) });
}));
reg(tool('rhymes', 'Find words that rhyme with a word (Datamuse).', { word: 'string' }, R, async (p) => {
  const d = await gj('https://api.datamuse.com/words?max=20&rel_rhy=' + encodeURIComponent(p.word || 'time'));
  return ok({ word: p.word, rhymes: d.map((x) => x.word) });
}));
reg(tool('random_quote', 'A random inspirational quote.', {}, R, async () => {
  const d = await gj('https://dummyjson.com/quotes/random');
  return ok({ quote: d.quote, author: d.author });
}));
reg(tool('number_fact', 'An interesting fact about a number (NumbersAPI).', { number: 'number — or "random"' }, R, async (p) => {
  const n = p.number == null ? 'random' : p.number;
  const t = await (await fetch('http://numbersapi.com/' + encodeURIComponent(n))).text();
  return ok({ number: n, fact: t });
}));
reg(tool('random_advice', 'A random piece of advice (AdviceSlip).', {}, R, async () => {
  const d = await gj('https://api.adviceslip.com/advice');
  return ok({ advice: d.slip.advice });
}));
reg(tool('public_holidays', 'Public holidays for a country + year (Nager.Date).', { country: 'string — ISO2 e.g. US', year: 'number — default 2026' }, R, async (p) => {
  const c = String(p.country || 'US').toUpperCase(), y = Number(p.year) || 2026;
  const d = await gj(`https://date.nager.at/api/v3/PublicHolidays/${y}/${c}`);
  return ok({ country: c, year: y, holidays: d.map((h) => ({ date: h.date, name: h.name, local: h.localName })) });
}));
reg(tool('recent_earthquakes', 'Significant earthquakes in the last day (USGS).', { min_magnitude: 'number — default 4.5' }, R, async (p) => {
  const d = await gj('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=10&starttime=' + new Date(Date.now() - 864e5).toISOString().slice(0, 10) + '&minmagnitude=' + (Number(p.min_magnitude) || 4.5));
  return ok({ count: d.features.length, quakes: d.features.map((f) => ({ magnitude: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString() })) });
}));
reg(tool('iss_location', 'Current location of the International Space Station.', {}, R, async () => {
  const d = await gj('https://api.wheretheiss.at/v1/satellites/25544');
  return ok({ latitude: d.latitude, longitude: d.longitude, altitude_km: d.altitude, velocity_kmh: d.velocity, timestamp: d.timestamp });
}));
reg(tool('predict_gender', 'Predict likely gender from a first name (Genderize).', { name: 'string' }, R, async (p) => {
  const d = await gj('https://api.genderize.io?name=' + encodeURIComponent(p.name || 'alex'));
  return ok({ name: d.name, gender: d.gender, probability: d.probability, basedOn: d.count });
}));
reg(tool('predict_age', 'Predict likely age from a first name (Agify).', { name: 'string' }, R, async (p) => {
  const d = await gj('https://api.agify.io?name=' + encodeURIComponent(p.name || 'alex'));
  return ok({ name: d.name, predictedAge: d.age, basedOn: d.count });
}));
reg(tool('predict_nationality', 'Predict likely nationality from a first name (Nationalize).', { name: 'string' }, R, async (p) => {
  const d = await gj('https://api.nationalize.io?name=' + encodeURIComponent(p.name || 'alex'));
  return ok({ name: d.name, countries: (d.country || []).slice(0, 3).map((c) => ({ country: c.country_id, probability: Math.round(c.probability * 100) / 100 })) });
}));
reg(tool('tv_show_search', 'Search TV shows — genre, rating, summary (TVMaze).', { query: 'string' }, R, async (p) => {
  const d = await gj('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(p.query || 'breaking bad'));
  return ok({ results: d.slice(0, 5).map((x) => ({ name: x.show.name, genres: x.show.genres, rating: x.show.rating && x.show.rating.average, premiered: x.show.premiered, status: x.show.status })) });
}));
reg(tool('food_product', 'Look up a food product by barcode — nutrition, ingredients (OpenFoodFacts).', { barcode: 'string — EAN/UPC' }, R, async (p) => {
  const d = await gj('https://world.openfoodfacts.org/api/v0/product/' + encodeURIComponent(p.barcode || '737628064502') + '.json');
  if (d.status !== 1) return ok({ barcode: p.barcode, note: 'not found' });
  const pr = d.product;
  return ok({ name: pr.product_name, brand: pr.brands, nutriscore: pr.nutriscore_grade, calories100g: pr.nutriments && pr.nutriments['energy-kcal_100g'], ingredients: (pr.ingredients_text || '').slice(0, 200) });
}));
reg(tool('universities', 'List universities in a country (Hipolabs).', { country: 'string — e.g. Canada' }, R, async (p) => {
  const d = await gj('http://universities.hipolabs.com/search?country=' + encodeURIComponent(p.country || 'United States'));
  return ok({ country: p.country, count: d.length, sample: d.slice(0, 10).map((u) => ({ name: u.name, web: (u.web_pages || [])[0] })) });
}));
reg(tool('weather_forecast', 'Current weather + 3-day forecast for coordinates (Open-Meteo, keyless).', { latitude: 'number', longitude: 'number' }, R, async (p) => {
  const lat = Number(p.latitude) || 40.71, lon = Number(p.longitude) || -74.0;
  const d = await gj(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`);
  return ok({ latitude: lat, longitude: lon, current: d.current, dailyMax: d.daily.temperature_2m_max, dailyMin: d.daily.temperature_2m_min, dates: d.daily.time });
}));
reg(tool('on_this_day', 'Notable historical events on today’s date (Wikipedia).', { month: 'number — 1-12 (optional)', day: 'number — 1-31 (optional)' }, R, async (p) => {
  const now = new Date(); const mo = Number(p.month) || (now.getMonth() + 1); const dy = Number(p.day) || now.getDate();
  const d = await gj(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mo}/${dy}`);
  return ok({ date: mo + '/' + dy, events: (d.events || []).slice(0, 6).map((e) => ({ year: e.year, text: e.text })) });
}));

module.exports = { TOOLS_RESEARCH, _count: Object.keys(TOOLS_RESEARCH).length };
