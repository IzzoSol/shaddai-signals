// backend/lib/pnl-images.js v2 — Vivid cinematic PNL card images.
// Rich prompts, preset fallbacks, auto cache. Callers always get a path or null.
'use strict';
const fs = require('fs');
const path = require('path');
const hf = require('./hf-keys');

const GENERATED_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'bot', 'pnl-generated');

function _ensureDir() {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

// ── TIER THEMES v2 ──────────────────────────────────────────────
// Each tier: full descriptive prompt for FLUX schnell.
// Denser phrases = richer output. No text/letters in image.
const TIER_THEMES = {
  1: {
    prompt: 'masterpiece ultra-detailed digital art, a single glowing teal crystal suspended in dark water, light refracting into rainbow shards on the surface, deep midnight blue background, soft bioluminescence, faint gold dust particles, macro lens shallow depth of field, soft bokeh, rim lighting from below, mysterious deep sea exploration, something awakening, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'GENESIS',
  },
  2: {
    prompt: 'masterpiece ultra-detailed digital art, a massive translucent diamond formation emerging from dark volcanic rock, electric green energy veins pulsing through cracks, sparks flying upward, electric green neon palette against obsidian black, chrome silver reflections, low angle hero shot, volumetric green fog, dramatic backlight, floating diamond shards catching green light, raw power born from stone, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'IGNITION',
  },
  5: {
    prompt: 'masterpiece ultra-detailed digital art, a chrome rocket piercing through a storm of golden lightning, energy shockwave rings expanding outward, debris orbiting in slow motion, emerald green molten gold hot white plasma core, embers floating, Dutch angle action shot, motion blur on edges sharp center focus, golden energy ribbons, escape velocity breaking free, the moment everything changes, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'LAUNCH',
  },
  10: {
    prompt: 'masterpiece ultra-detailed digital art, a massive golden supernova explosion in deep space, molten gold liquid splashing outward, crystalline debris forming sacred geometry patterns, blazing gold white-hot plasma deep crimson shadows diamond sparkles, ultra-wide establishing shot, lens flare, particle volumetrics, god rays through debris, golden shards and crystalline particles suspended in zero gravity, overwhelming beautiful destruction, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'SUPERNOVA',
  },
  15: {
    prompt: 'masterpiece ultra-detailed digital art, a towering crystalline structure crackling with purple lightning, energy arcs connecting floating platforms, storm clouds spiraling above, electric purple titanium white neon cyan gold lightning, extreme low angle looking up, forced perspective dramatic storm lighting, lightning arcs and purple energy plasma streams, thunder god awakening absolute electrical dominance, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'DOMINION',
  },
  20: {
    prompt: 'masterpiece ultra-detailed digital art, a throne of molten gold rising from obsidian ocean, crown of liquid gold suspended above, golden light beams piercing through dark clouds, deep liquid gold obsidian black warm amber glow ruby accents, dramatic front-facing portrait, studio lighting reflective surface luxury photography, liquid gold droplets and amber particles floating, coronation of a king undeniable royalty, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'SOVEREIGN',
  },
  25: {
    prompt: 'masterpiece ultra-detailed digital art, a colossal diamond forming at the center of a spiral nebula, gravitational lens bending light around it, stardust rivers flowing inward, royal purple nebula magenta gas clouds diamond white core gold stardust, deep space wide shot nebula volumetrics lens distortion, stardust particles and nebula wisps wrapping around the diamond, cosmic genesis infinite scale diamond heart of the universe, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'MYTHIC',
  },
  30: {
    prompt: 'masterpiece ultra-detailed digital art, a dimensional portal tearing open in deep space, plasma energy pouring through, reality fracturing into geometric shards around the edges, plasma blue hot white center cyan energy deep space black, fisheye perspective from inside the rift energy wrapping around camera, plasma tendrils and fracturing reality shards, tearing through dimensions breaking reality unstoppable momentum, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'RIFT',
  },
  35: {
    prompt: 'masterpiece ultra-detailed digital art, a volcano erupting with molten gold lava, obsidian spires cracking from pressure, lava rivers carving through dark terrain, ember storm overhead, molten red burning orange deep volcanic black gold magma veins, epic landscape shot aerial perspective atmospheric haze, floating obsidian chunks and golden ember rain, primordial eruption unstoppable natural force, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'ERUPTION',
  },
  40: {
    prompt: 'masterpiece ultra-detailed digital art, a chrome panther mid-pounce through neon-lit cyber cityscape, energy trail behind it, reflective surfaces catching every light source, neon magenta pitch black chrome white highlights electric pink, freeze-frame action shallow DOF neon reflections, neon light streaks and chrome reflections, apex predator calculated precision beautiful lethality, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'APEX',
  },
  50: {
    prompt: 'masterpiece ultra-detailed digital art, a white hole birthing light into absolute darkness, prismatic rainbow shockwave expanding in all directions, sacred geometry forming from pure light, cosmic rebirth, rainbow prismatic pure white core iridescent edges gold particle halo, centered symmetrical composition god rays prismatic lens flare infinite depth, prismatic light particles and rainbow energy trails, beyond legendary rebirth of the cosmos, no text no letters no words no watermark, cinematic 4K hyper-detailed',
    label: 'ASCENSION',
  },
};

// Map multiplier to closest tier
function _closestTier(mult) {
  const levels = [1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 50];
  let best = 1;
  for (const lv of levels) { if (mult >= lv) best = lv; }
  return best;
}

// Cache path: SYMBOL-MINTINT16-TIERx.png
function _cachePath(call, tier) {
  const mint = (call.mint || 'unknown').slice(0, 16);
  const sym = (call.symbol || 'token').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toUpperCase();
  return path.join(GENERATED_DIR, `${sym}-${mint}-${tier}x.png`);
}

function _isFresh(fp) {
  try { return (Date.now() - fs.statSync(fp).mtimeMs) < 24 * 3600000; } catch { return false; }
}

// ── GENERATE ─────────────────────────────────────────────────────
async function generatePnlImage(call) {
  try {
    _ensureDir();
    const mult = Math.max(1, Number(call.curMult || call.peakMult || 1));
    const tier = _closestTier(mult);
    const cached = _cachePath(call, tier);
    if (_isFresh(cached)) return cached;

    const theme = TIER_THEMES[tier] || TIER_THEMES[1];
    const prompt = theme.prompt;

    const result = await hf.generateSafe(prompt, { byok: undefined, width: 1024, height: 1024 });

    if (result.buffer) {
      fs.writeFileSync(cached, result.buffer);
      console.log(`[pnl-images] generated: ${path.basename(cached)} (via ${result.provider})`);
      return cached;
    }

    if (result.fallbackUrl) {
      try {
        const r = await fetch(result.fallbackUrl, { signal: AbortSignal.timeout(45000) });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          fs.writeFileSync(cached, buf);
          console.log(`[pnl-images] Pollinations fallback: ${path.basename(cached)}`);
          return cached;
        }
      } catch (e) { console.warn('[pnl-images] Pollinations fetch failed:', e.message); }
    }

    console.warn('[pnl-images] generation failed:', result.hfError || 'unknown');
    return null;
  } catch (e) {
    console.warn('[pnl-images] error:', e.message);
    return null;
  }
}

// ── PRESET URL (no generation needed, instant) ───────────────────
// Returns a URL to a preset tier image the frontend can display instantly.
function presetImageUrl(mult) {
  const tier = _closestTier(Math.max(1, Number(mult || 1)));
  const theme = TIER_THEMES[tier] || TIER_THEMES[1];
  return `/api/pnl-preset/${tier}`;
}

// ── BATCH PRE-GENERATE ───────────────────────────────────────────
async function preGenerateActive(activeCalls) {
  _ensureDir();
  let count = 0;
  for (const call of (activeCalls || [])) {
    try {
      const mult = Math.max(1, Number(call.curMult || call.peakMult || 1));
      const tier = _closestTier(mult);
      const cached = _cachePath(call, tier);
      if (_isFresh(cached)) continue;
      const img = await generatePnlImage(call);
      if (img) count++;
    } catch { }
  }
  if (count > 0) console.log(`[pnl-images] pre-generated ${count} image(s)`);
  return count;
}

// ── EXPORTS ──────────────────────────────────────────────────────
module.exports = { generatePnlImage, preGenerateActive, presetImageUrl, GENERATED_DIR, TIER_THEMES };