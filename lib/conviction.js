'use strict';
/**
 * conviction.js — PURE scoring module for a crypto signals bot.
 *
 * No I/O, no network, no fs, no npm deps. Deterministic. Never throws.
 * Turns token holder data into a 0-100 "conviction" score and combines
 * multiple data-source confirmations into a confidence score.
 *
 * Public interface:
 *   convictionScore({ holderCount, topHolderPct, top10Pct, whales }) -> { score, signals, bonuses, label }
 *   convictionLine(result) -> short one-line HTML string for a Telegram card
 *   confirmationScore(sources) -> { score, confirmed, total }
 */

// ----------------------------------------------------------------------------
// Safe coercion helpers — never throw, always return a sane number/array.
// ----------------------------------------------------------------------------

function _num(v, def) {
  const d = (def === undefined) ? 0 : def;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function _clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function _arr(v) {
  return Array.isArray(v) ? v : [];
}

function _round1(n) {
  return Math.round(n * 10) / 10;
}

// ----------------------------------------------------------------------------
// "Clean / round" whale heuristic.
// A whale amount is "clean" if it sits on (or within ~2% of) a roundish number:
//  - divisible by a power of 10 (10, 100, 1_000, ...), OR
//  - within ~2% of the nearest such power-of-10 multiple.
// Bot clusters tend to be jagged (e.g. 13,472.913), real early believers tend
// to buy round bags (1,000 / 5,000 / 100,000).
// ----------------------------------------------------------------------------

function _isRoundAmount(n) {
  const x = Math.abs(_num(n, 0));
  if (x <= 0) return false;
  if (x < 10) return false; // too small to judge "roundness" meaningfully

  // Determine the magnitude (largest power of 10 <= x), then step down a couple
  // of decades so 12,500 counts as round (multiple of 500 = 5 * 10^2).
  const mag = Math.floor(Math.log10(x)); // e.g. 12500 -> 4
  for (let p = mag; p >= Math.max(1, mag - 2); p--) {
    const step = Math.pow(10, p);
    if (step <= 0) continue;
    const nearest = Math.round(x / step) * step;
    if (nearest <= 0) continue;
    const drift = Math.abs(x - nearest) / nearest;
    if (drift <= 0.02) return true; // within ~2% of a round multiple of 10^p
  }
  return false;
}

function _whaleAmount(w) {
  if (typeof w === 'number') return _num(w, 0);
  if (w && typeof w === 'object') return _num(w.amount, 0);
  return _num(w, 0);
}

// ----------------------------------------------------------------------------
// Core conviction score.
// 4 holder signals, 25 base points each (scaled within each signal), summed to
// a 0-100 base, then confidence bonuses added on top and clamped to 100.
// ----------------------------------------------------------------------------

function convictionScore(input) {
  const src = (input && typeof input === 'object') ? input : {};

  const holderCount  = _clamp(_num(src.holderCount, 0), 0, Number.MAX_SAFE_INTEGER);
  const topHolderPct = _clamp(_num(src.topHolderPct, 0), 0, 100);
  const top10Pct     = _clamp(_num(src.top10Pct, 0), 0, 100);
  const whales       = _arr(src.whales);

  // No meaningful data at all → conviction is 0 (can't be bullish on nothing).
  // A token with zero holders, no top-holder %, no top10 %, and no whales gives
  // us no signal; the "empty distribution looks healthy" artifact must not leak.
  const hasData = holderCount > 0 || topHolderPct > 0 || top10Pct > 0 || whales.length > 0;
  if (!hasData) {
    return {
      score: 0,
      signals: { holderCount: 0, whaleConviction: 0, distribution: 0, stableWhales: 0 },
      bonuses: [],
      label: '⚠️ Weak',
    };
  }

  const PER = 25; // points per signal → 4 * 25 = 100 base

  // --- Signal 1 — 👥 Holder Count: more holders = more bullish.
  //     ≥100 holders = max (25). Linear ramp 0..100 holders.
  const s1 = _round1(PER * _clamp(holderCount / 100, 0, 1));

  // --- Signal 2 — 🐋 Whale Conviction: top-holder % as early-believer conviction.
  //     ≥50% top holder = max (25). Linear ramp 0..50%.
  const s2 = _round1(PER * _clamp(topHolderPct / 50, 0, 1));

  // --- Signal 3 — 📊 Distribution: how spread out holders are.
  //     top10 < 70% = healthier; more points the lower top10 is.
  //     top10 = 0%  → full 25;  top10 ≥ 70% → 0.
  const s3 = _round1(PER * _clamp((70 - top10Pct) / 70, 0, 1));

  // --- Signal 4 — 💎 Stable Whales: whales holding round amounts (not bots).
  //     ≥3 clean whales = max (25). Linear ramp 0..3 clean whales.
  let cleanWhales = 0;
  for (let i = 0; i < whales.length; i++) {
    if (_isRoundAmount(_whaleAmount(whales[i]))) cleanWhales++;
  }
  const s4 = _round1(PER * _clamp(cleanWhales / 3, 0, 1));

  const signals = {
    holderCount: s1,
    whaleConviction: s2,
    distribution: s3,
    stableWhales: s4,
  };

  let score = s1 + s2 + s3 + s4;

  // --- Confidence bonuses (added on top, then clamp to 100).
  const bonuses = [];

  // Whale top10 bonus — apply the single highest matching bonus.
  if (top10Pct >= 50) {
    bonuses.push({ label: 'top10 ≥ 50%', points: 5 });
  } else if (top10Pct >= 15) {
    bonuses.push({ label: 'top10 ≥ 15%', points: 3 });
  }

  // Holder-count bonus — apply the single highest matching bonus.
  if (holderCount >= 200) {
    bonuses.push({ label: '≥ 200 holders', points: 8 });
  } else if (holderCount >= 100) {
    bonuses.push({ label: '≥ 100 holders', points: 5 });
  } else if (holderCount >= 50) {
    bonuses.push({ label: '≥ 50 holders', points: 3 });
  }

  // (≥3 clean whales is already counted in signal 4 — no double-count.)

  for (let i = 0; i < bonuses.length; i++) score += bonuses[i].points;

  score = _clamp(_round1(score), 0, 100);

  let label;
  if (score >= 70) label = '🔥 High';
  else if (score >= 45) label = '✅ Solid';
  else label = '⚠️ Weak';

  return { score, signals, bonuses, label };
}

// ----------------------------------------------------------------------------
// One-line HTML string for a Telegram card.
// e.g. "🐋 Conviction 78/100 · 142 holders · top10 41%"
// ----------------------------------------------------------------------------

function convictionLine(result) {
  const r = (result && typeof result === 'object') ? result : {};
  const score = _clamp(_num(r.score, 0), 0, 100);
  return `🐋 <b>Conviction ${Math.round(score)}/100</b> ${r.label || ''}`.trim();
}

// A richer helper is often wanted; keep the documented behaviour but allow the
// caller to pass the original holders too. Overload: if a second arg with
// holderCount/top10Pct is given, include those facts in the line.
function convictionLineFull(result, holders) {
  const base = convictionLine(result);
  const h = (holders && typeof holders === 'object') ? holders : {};
  const parts = [base];
  if (h.holderCount !== undefined) parts.push(`${Math.round(_num(h.holderCount, 0))} holders`);
  if (h.top10Pct !== undefined) parts.push(`top10 ${Math.round(_num(h.top10Pct, 0))}%`);
  return parts.join(' · ');
}

// ----------------------------------------------------------------------------
// Confirmation score — fraction of data sources confirmed.
// sources = array of booleans or objects with { ok: true }.
// ----------------------------------------------------------------------------

function confirmationScore(sources) {
  const list = _arr(sources);
  const total = list.length;
  let confirmed = 0;
  for (let i = 0; i < total; i++) {
    const s = list[i];
    let ok;
    if (typeof s === 'boolean') ok = s;
    else if (s && typeof s === 'object') ok = !!s.ok;
    else ok = !!s;
    if (ok) confirmed++;
  }
  const score = total > 0 ? _clamp(_round1((confirmed / total) * 100), 0, 100) : 0;
  return { score, confirmed, total };
}

module.exports = {
  convictionScore,
  convictionLine,
  convictionLineFull,
  confirmationScore,
  _isRoundAmount, // exported for testing
};

// ----------------------------------------------------------------------------
// Self-test — run: node backend/lib/conviction.js
// ----------------------------------------------------------------------------

if (require.main === module) {
  const show = (name, res) => {
    console.log(`\n=== ${name} ===`);
    console.log(JSON.stringify(res, null, 2));
    console.log('line:', convictionLineFull(res, res._holders || {}));
  };

  // (a) Strong token: 150 holders, top holder 55%, top10 45%, 4 round whales.
  const strongInput = {
    holderCount: 150,
    topHolderPct: 55,
    top10Pct: 45,
    whales: [{ amount: 1000 }, { amount: 5000 }, { amount: 100000 }, { amount: 250000 }],
  };
  const strong = convictionScore(strongInput);
  strong._holders = strongInput;
  show('STRONG token', strong);

  // (b) Weak token: 8 holders, top holder 5%, top10 90%, no round whales.
  const weakInput = {
    holderCount: 8,
    topHolderPct: 5,
    top10Pct: 90,
    whales: [{ amount: 137.913 }, { amount: 42.7 }],
  };
  const weak = convictionScore(weakInput);
  weak._holders = weakInput;
  show('WEAK token', weak);

  // (c) Empty / missing input.
  const empty = convictionScore(undefined);
  show('EMPTY input', empty);

  // Confirmation score demo.
  console.log('\n=== confirmationScore ===');
  console.log(JSON.stringify(confirmationScore([true, { ok: true }, false, true]), null, 2));

  // Ordering assertions.
  console.log('\n=== ORDERING ===');
  const strongGtWeak = strong.score > weak.score;
  const emptyZero = empty.score === 0;
  console.log(`strong(${strong.score}) > weak(${weak.score}) : ${strongGtWeak}`);
  console.log(`empty === 0 : ${emptyZero}`);
  console.log(`strong has ≥100-holder bonus: ${strong.bonuses.some(b => /100 holders/.test(b.label))}`);
  console.log(`strong has top10 bonus: ${strong.bonuses.some(b => /top10/.test(b.label))}`);
  console.log(strongGtWeak && emptyZero ? '\n✅ ALL ORDERING HELD' : '\n❌ ORDERING FAILED');
}
