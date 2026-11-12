// backend/lib/hf-keys.js — HuggingFace key pool with auto-rotation + free fallback.
// Loads keys from env, rotating across them on 401/402/403/429. Sources (any/all):
//   • HF_TOKENS  = "hf_a,hf_b,hf_c"   (comma-separated list)
//   • HF_KEY_1 … HF_KEY_5             (numbered — the 5 rotating keys the owner sets in Render)
//   • HF_TOKEN / HUGGINGFACE_API_KEY  (single, legacy)
//   • backend/data/runtime-keys.json  (gitignored)
// A user-supplied BYOK key (passed per-request) is tried FIRST, then the pool.
// If NO key works (or none configured), generate() falls back to keyless Pollinations
// so image tools NEVER hard-fail — they always return a usable image URL.
// The token NEVER leaves the server (only a served URL / dataUri is returned to clients).
const fs = require('fs');
const path = require('path');

// hf-inference deprecated its serverless image models (410). HF now routes image gen through
// Inference Providers; fal-ai serves FLUX.1-schnell and works with a standard hf_ token.
const FLUX = 'https://router.huggingface.co/fal-ai/fal-ai/flux/schnell';

// Ordered key list. `byok` (user's own hf_ key) is placed first when valid.
function keys(byok) {
  const out = [];
  const add = (k) => { if (k && /^hf_/.test(String(k).trim()) && !out.includes(String(k).trim())) out.push(String(k).trim()); };
  add(byok);                                                      // 1. per-request BYOK first
  if (process.env.HF_TOKENS) String(process.env.HF_TOKENS).split(',').forEach(add); // 2. csv list
  for (let i = 1; i <= 9; i++) add(process.env[`HF_KEY_${i}`]);   // 3. HF_KEY_1..9 (the 5 rotating keys)
  add(process.env.HF_TOKEN); add(process.env.HUGGINGFACE_API_KEY); // 4. legacy singles
  try {                                                            // 5. gitignored runtime file
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'runtime-keys.json'), 'utf8'));
    if (Array.isArray(j.HF_TOKENS)) j.HF_TOKENS.forEach(add);
    if (Array.isArray(j.HF_KEYS)) j.HF_KEYS.forEach(add);
    add(j.HF_TOKEN); add(j.HUGGINGFACE_API_KEY);
  } catch {}
  return out;
}

// Keyless free fallback (no HF key needed). Returns a served image URL, never throws.
function pollinationsUrl(prompt, { width = 1024, height = 1024, seed } = {}) {
  const p = encodeURIComponent(String(prompt || 'abstract AI art').slice(0, 900));
  const s = seed != null ? `&seed=${encodeURIComponent(seed)}` : `&seed=${Math.floor(Math.random() * 1e6)}`;
  return `https://image.pollinations.ai/prompt/${p}?width=${width}&height=${height}&nologo=true&model=flux${s}`;
}

// Generate one image. Rotates across BYOK + all pool keys on depletion/rate-limit.
// Returns { buffer } on HF success. If every key fails (or none exist), returns
// { fallbackUrl } (keyless Pollinations) instead of throwing — callers must handle both.
async function generateSafe(prompt, { model = FLUX, byok, width = 1024, height = 1024 } = {}) {
  const pool = keys(byok);
  const isFal = /fal-ai/.test(model);
  const body = isFal
    ? JSON.stringify({ prompt: String(prompt).slice(0, 1800), image_size: { width, height }, num_images: 1 })
    : JSON.stringify({ inputs: prompt });
  let lastErr;
  for (let i = 0; i < pool.length; i++) {
    try {
      const r = await fetch(model, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + pool[i], 'Content-Type': 'application/json', 'x-wait-for-model': 'true' },
        body,
      });
      const ct = r.headers.get('content-type') || '';
      if (r.ok) {
        // raw image bytes (legacy serverless) …
        if (ct.startsWith('image')) return { buffer: Buffer.from(await r.arrayBuffer()), provider: 'huggingface-flux' };
        // …or JSON with an image URL (fal-ai / provider style) → fetch the bytes
        try {
          const j = await r.json();
          const url = j && j.images && j.images[0] && (j.images[0].url || j.images[0]);
          if (url) { const ir = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (ir.ok) return { buffer: Buffer.from(await ir.arrayBuffer()), provider: 'hf-fal-flux' }; }
          lastErr = new Error('HF ok but no image url');
        } catch (e) { lastErr = new Error('HF json parse: ' + (e && e.message)); }
        continue;
      }
      if ([402, 429, 401, 403].includes(r.status)) { lastErr = new Error(`HF ${r.status} on key#${i + 1}`); continue; }
      if (r.status === 503) { await new Promise(s => setTimeout(s, 8000)); i--; continue; } // model warming
      let b = ''; try { b = (await r.text()).slice(0, 160); } catch {}
      lastErr = new Error(`HF ${r.status} ${b}`);
    } catch (e) { lastErr = e; }
  }
  // No HF key succeeded → keyless free fallback so image tools never hard-fail.
  return { fallbackUrl: pollinationsUrl(prompt, { width, height }), provider: 'pollinations-free', hfError: lastErr && lastErr.message };
}

// Back-compat: throws on total failure (returns a Buffer). Prefer generateSafe().
async function generate(prompt, opts = {}) {
  const out = await generateSafe(prompt, opts);
  if (out.buffer) return out.buffer;
  const e = new Error('All HF keys failed: ' + (out.hfError || 'no key configured')); e.code = 'ALL_FAILED'; throw e;
}

module.exports = { keys, generate, generateSafe, pollinationsUrl, FLUX };
