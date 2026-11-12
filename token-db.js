/* ══════════════════════════════════════════════════════════════════════════
   token-db.js — Token snapshot persistence, call outcome tracking,
   and ZEROX learning data.

   Stores:
     - Token snapshots (seen across providers, timestamps, metrics)
     - Call outcomes (entry, peak, current, source, multipliers)
     - Feature vectors for ZEROX learning (what made winners win)
     - Provider overlap records (multi-source confirmation)
     - Historical stats (hit rates by source, FDV range, social presence)
     - FAILURE MEMORY (why calls fail, cross-reference patterns)
     - AUTO-TUNE (adjust filters based on win/loss patterns)

   All persisted to JSON files. Designed for 24/7 operation on Render.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

// TG_DATA_DIR lets state live on a Render persistent disk (paid plan) so learning/dedupe/PNL
// survive redeploys. Unset (free plan) = ephemeral local dir; seed-guards mitigate restart repeats.
const DATA_DIR = process.env.TG_DATA_DIR || path.join(__dirname, 'data');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'token-snapshots.json');
const CALLS_FILE = path.join(DATA_DIR, 'token-calls.json');
const LEARNING_FILE = path.join(DATA_DIR, 'zerox-learning.json');
const OVERLAP_FILE = path.join(DATA_DIR, 'source-overlap.json');
const FAILURE_FILE = path.join(DATA_DIR, 'zerox-failures.json');
const AUTOTUNE_FILE = path.join(DATA_DIR, 'zerox-autotune.json');

function _ensure() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function _read(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function _write(f, o) { try { _ensure(); fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) {} }

// ══════════════════════════════════════════════════════════════════════════
//  TOKEN SNAPSHOTS — when we first see a token, track its journey
// ══════════════════════════════════════════════════════════════════════════
let _snaps = _read(SNAPSHOTS_FILE, {});

function upsertSnapshot(mint, data) {
  if (!mint) return;
  const now = Date.now();
  if (!_snaps[mint]) {
    _snaps[mint] = {
      mint, chain: data.chain || 'solana',
      name: data.name || '', symbol: data.symbol || '',
      firstSeen: now, lastSeen: now,
      entryFdv: data.fdv || data.entryFdv || 0,
      entryPrice: data.price || data.entryPrice || 0,
      sources: {},          // { dexscreener: { lastSeen, fdv }, geckoterminal: { ... } }
      metrics: {},          // { holders, top10Pct, lpLocked, socialScore, ... }
      confirmed: false,
      validated: false,
      enriched: false,
    };
  }
  const snap = _snaps[mint];
  snap.lastSeen = now;
  if (data.name) snap.name = data.name;
  if (data.symbol) snap.symbol = data.symbol;
  if (data.fdv && !snap.entryFdv) snap.entryFdv = data.fdv;
  if (data.price && !snap.entryPrice) snap.entryPrice = data.price;
  // record which source saw it
  if (data.source) {
    snap.sources[data.source] = { lastSeen: now, fdv: data.fdv || 0, price: data.price || 0, raw: data.raw || null };
  }
  // merge metrics
  if (data.metrics) Object.assign(snap.metrics, data.metrics);
  // cleanup old snapshots (keep 30 days)
  const cutoff = now - 30 * 24 * 3600 * 1000;
  for (const [k, v] of Object.entries(_snaps)) {
    if (v.lastSeen < cutoff) delete _snaps[k];
  }
  return snap;
}

function getSnapshot(mint) { return _snaps[mint] || null; }
function getSnapshots() { return _snaps; }
function saveSnapshots() { _write(SNAPSHOTS_FILE, _snaps); }

// ══════════════════════════════════════════════════════════════════════════
//  CALL OUTCOMES — what happened after we called a token
// ══════════════════════════════════════════════════════════════════════════
let _calls = _read(CALLS_FILE, { calls: [], features: [] });

function recordOutcome(c) {
  const now = Date.now();
  _calls.calls.push({
    mint: c.mint, chain: c.chain || 'solana',
    name: c.name || '', symbol: c.symbol || '',
    source: c.source || 'unknown',
    entryFdv: c.entryFdv || 0, entryPrice: c.entryPrice || 0,
    ts: now,
    peakMult: 1, curMult: 1, curFdv: c.entryFdv || 0,
    // feature vector (what we knew at call time)
    features: {
      sourceCount: c.sourceCount || 1,
      sources: c.sources || [c.source],
      socialScore: c.socialScore || 0,
      hasWebsite: c.hasWebsite || false,
      hasTwitter: c.hasTwitter || false,
      hasTelegram: c.hasTelegram || false,
      hasDiscord: c.hasDiscord || false,
      locked: c.locked || false,
      top10Pct: c.top10Pct || 0,
      insiders: c.insiders || 0,
      bundlers: c.bundlers || false,
      snipers: c.snipers || false,
      rugScore: c.rugScore || 0,
      lpPct: c.lpPct || 0,
      holders: c.holders || 0,
      fdvAtCall: c.entryFdv || 0,
      volAtCall: c.vol24h || 0,
      liqAtCall: c.liquidity || 0,
      devPct: c.devPct || 0,
      venue: c.venue || '',
    },
    // outcome
    milestones: [],
    closed: false,
  });
  if (_calls.calls.length > 5000) _calls.calls = _calls.calls.slice(-5000);
  _write(CALLS_FILE, _calls);
}

function updateOutcome(mint, updates) {
  const c = _calls.calls.find(x => x.mint === mint && !x.closed);
  if (!c) return;
  Object.assign(c, updates);
  if (updates.peakMult && updates.peakMult >= 2 && !c.milestones.includes(2)) c.milestones.push(2);
  if (updates.peakMult && updates.peakMult >= 5 && !c.milestones.includes(5)) c.milestones.push(5);
  if (updates.peakMult && updates.peakMult >= 10 && !c.milestones.includes(10)) c.milestones.push(10);
  if (updates.peakMult && updates.peakMult >= 25 && !c.milestones.includes(25)) c.milestones.push(25);
  _write(CALLS_FILE, _calls);
}

function getOutcomes() { return _calls.calls; }
function getWinners() { return _calls.calls.filter(c => c.peakMult >= 2); }
function getLosers() { return _calls.calls.filter(c => c.peakMult < 2 && c.closed); }

// ══════════════════════════════════════════════════════════════════════════
//  ZEROX LEARNING — extract patterns from winners/losers
//  Enhanced: tracks WHY calls fail, cross-references features, auto-tunes
// ══════════════════════════════════════════════════════════════════════════
let _learning = _read(LEARNING_FILE, {
  lastAnalyzed: 0,
  patterns: {},       // { feature: { winRate, avgMult, sampleSize } }
  weights: {},        // computed weights for scoring
  totalAnalyzed: 0,
  crossRef: {},       // NEW: cross-reference matrix — feature pairs that correlate with wins/losses
  failureProfile: {},  // NEW: what losers look like — feature fingerprint of failed calls
  winnerProfile: {},   // NEW: what winners look like — feature fingerprint of successful calls
});

function analyzeOutcomes() {
  const winners = _calls.calls.filter(c => c.peakMult >= 2);
  const losers = _calls.calls.filter(c => c.peakMult < 2);
  if (winners.length + losers.length < 3) return _learning;   // need data (lowered from 5)

  const patterns = {};
  const _analyze = (feat, val, isWin) => {
    const key = feat + ':' + val;
    if (!patterns[key]) patterns[key] = { wins: 0, losses: 0, totalMult: 0, peakMults: [] };
    if (isWin) { patterns[key].wins++; patterns[key].totalMult += 1; }
    else patterns[key].losses++;
  };

  // ── SINGLE FEATURE ANALYSIS ────────────────────────────────────────────
  for (const w of winners) {
    if (!w.features) continue;
    _analyze('source', w.source, true);
    _analyze('sourceCount', Math.min(w.features.sourceCount || 1, 3), true);
    _analyze('socialScore', Math.min(w.features.socialScore || 0, 6), true);
    _analyze('hasWebsite', w.features.hasWebsite || false, true);
    _analyze('hasTwitter', w.features.hasTwitter || false, true);
    _analyze('locked', w.features.locked || false, true);
    _analyze('top10Bucket', (w.features.top10Pct || 0) < 18 ? 'clean' : (w.features.top10Pct || 0) < 30 ? 'moderate' : 'heavy', true);
    _analyze('fdvBucket', (w.features.fdvAtCall || 0) < 50000 ? 'micro' : (w.features.fdvAtCall || 0) < 200000 ? 'small' : 'mid', true);
    _analyze('rugBucket', (w.features.rugScore || 0) >= 70 ? 'safe' : (w.features.rugScore || 0) >= 45 ? 'ok' : 'risky', true);
    _analyze('bundlers', w.features.bundlers || false, true);
    _analyze('snipers', w.features.snipers || false, true);
    _analyze('venue', w.features.venue || 'unknown', true);
    _analyze('lpBucket', (w.features.lpPct || 0) >= 99 ? 'full' : (w.features.lpPct || 0) >= 80 ? 'high' : (w.features.lpPct || 0) > 0 ? 'low' : 'none', true);
    _analyze('holderBucket', (w.features.holders || 0) >= 100 ? 'many' : (w.features.holders || 0) >= 20 ? 'some' : 'few', true);
    _analyze('liqBucket', (w.features.liqAtCall || 0) >= 10000 ? 'deep' : (w.features.liqAtCall || 0) >= 3000 ? 'ok' : 'thin', true);
  }
  for (const l of losers) {
    if (!l.features) continue;
    _analyze('source', l.source, false);
    _analyze('sourceCount', Math.min(l.features.sourceCount || 1, 3), false);
    _analyze('socialScore', Math.min(l.features.socialScore || 0, 6), false);
    _analyze('hasWebsite', l.features.hasWebsite || false, false);
    _analyze('hasTwitter', l.features.hasTwitter || false, false);
    _analyze('locked', l.features.locked || false, false);
    _analyze('top10Bucket', (l.features.top10Pct || 0) < 18 ? 'clean' : (l.features.top10Pct || 0) < 30 ? 'moderate' : 'heavy', false);
    _analyze('fdvBucket', (l.features.fdvAtCall || 0) < 50000 ? 'micro' : (l.features.fdvAtCall || 0) < 200000 ? 'small' : 'mid', false);
    _analyze('rugBucket', (l.features.rugScore || 0) >= 70 ? 'safe' : (l.features.rugScore || 0) >= 45 ? 'ok' : 'risky', false);
    _analyze('bundlers', l.features.bundlers || false, false);
    _analyze('snipers', l.features.snipers || false, false);
    _analyze('venue', l.features.venue || 'unknown', false);
    _analyze('lpBucket', (l.features.lpPct || 0) >= 99 ? 'full' : (l.features.lpPct || 0) >= 80 ? 'high' : (l.features.lpPct || 0) > 0 ? 'low' : 'none', false);
    _analyze('holderBucket', (l.features.holders || 0) >= 100 ? 'many' : (l.features.holders || 0) >= 20 ? 'some' : 'few', false);
    _analyze('liqBucket', (l.features.liqAtCall || 0) >= 10000 ? 'deep' : (l.features.liqAtCall || 0) >= 3000 ? 'ok' : 'thin', false);
  }

  // ── CROSS-REFERENCE: feature PAIRS that predict wins ────────────────────
  const crossRef = {};
  const _cross = (pair, isWin) => {
    if (!crossRef[pair]) crossRef[pair] = { wins: 0, losses: 0 };
    if (isWin) crossRef[pair].wins++; else crossRef[pair].losses++;
  };
  for (const w of winners) {
    if (!w.features) continue;
    const f = w.features;
    const src = w.source;
    _cross(src + '+fdv:' + ((f.fdvAtCall || 0) < 50000 ? 'micro' : 'not_micro'), true);
    _cross(src + '+locked:' + (f.locked || false), true);
    _cross(src + '+rug:' + ((f.rugScore || 0) >= 45 ? 'ok' : 'bad'), true);
    _cross(src + '+lp:' + ((f.lpPct || 0) >= 80 ? 'locked' : 'unlocked'), true);
    _cross('fdv:' + ((f.fdvAtCall || 0) < 50000 ? 'micro' : 'not_micro') + '+lp:' + ((f.lpPct || 0) >= 80 ? 'locked' : 'unlocked'), true);
    _cross('rug:' + ((f.rugScore || 0) >= 45 ? 'ok' : 'bad') + '+locked:' + (f.locked || false), true);
  }
  for (const l of losers) {
    if (!l.features) continue;
    const f = l.features;
    const src = l.source;
    _cross(src + '+fdv:' + ((f.fdvAtCall || 0) < 50000 ? 'micro' : 'not_micro'), false);
    _cross(src + '+locked:' + (f.locked || false), false);
    _cross(src + '+rug:' + ((f.rugScore || 0) >= 45 ? 'ok' : 'bad'), false);
    _cross(src + '+lp:' + ((f.lpPct || 0) >= 80 ? 'locked' : 'unlocked'), false);
    _cross('fdv:' + ((f.fdvAtCall || 0) < 50000 ? 'micro' : 'not_micro') + '+lp:' + ((f.lpPct || 0) >= 80 ? 'locked' : 'unlocked'), false);
    _cross('rug:' + ((f.rugScore || 0) >= 45 ? 'ok' : 'bad') + '+locked:' + (f.locked || false), false);
  }
  // compute cross-ref win rates
  for (const [pair, v] of Object.entries(crossRef)) {
    const total = v.wins + v.losses;
    crossRef[pair].winRate = total > 0 ? Math.round((v.wins / total) * 100) : 0;
    crossRef[pair].sampleSize = total;
  }

  // ── WINNER/LOSER PROFILES ──────────────────────────────────────────────
  const winnerProfile = _buildProfile(winners);
  const failureProfile = _buildProfile(losers);

  // ── COMPUTE WEIGHTS ────────────────────────────────────────────────────
  const weights = {};
  for (const [key, v] of Object.entries(patterns)) {
    const total = v.wins + v.losses;
    const winRate = total > 0 ? v.wins / total : 0.5;
    const avgMult = v.wins > 0 ? v.totalMult / v.wins : 1;
    patterns[key].winRate = Math.round(winRate * 100);
    patterns[key].avgMult = Math.round(avgMult * 10) / 10;
    patterns[key].sampleSize = total;
    weights[key] = Math.round((winRate - 0.5) * 100);   // -50 to +50 bonus
  }

  _learning = {
    lastAnalyzed: Date.now(),
    patterns, weights,
    totalAnalyzed: winners.length + losers.length,
    crossRef, failureProfile, winnerProfile,
    overallHitRate: Math.round((winners.length / (winners.length + losers.length)) * 100),
    hitRateBySource: _hitRateBySource(winners, losers),
  };
  _write(LEARNING_FILE, _learning);
  return _learning;
}

// build a profile: avg values for each feature in a set of calls
function _buildProfile(calls) {
  if (!calls.length) return {};
  const f = { fdv: 0, rugScore: 0, lpPct: 0, holders: 0, top10Pct: 0, socialScore: 0, vol24h: 0, liq: 0 };
  let n = 0;
  for (const c of calls) {
    if (!c.features) continue;
    const feat = c.features;
    f.fdv += feat.fdvAtCall || 0;
    f.rugScore += feat.rugScore || 0;
    f.lpPct += feat.lpPct || 0;
    f.holders += feat.holders || 0;
    f.top10Pct += feat.top10Pct || 0;
    f.socialScore += feat.socialScore || 0;
    f.vol24h += feat.volAtCall || 0;
    f.liq += feat.liqAtCall || 0;
    n++;
  }
  if (n > 0) { for (const k of Object.keys(f)) f[k] = Math.round(f[k] / n); }
  f.sampleSize = n;
  return f;
}

function _hitRateBySource(winners, losers) {
  const bySrc = {};
  for (const w of winners) { if (!bySrc[w.source]) bySrc[w.source] = { wins: 0, total: 0 }; bySrc[w.source].wins++; bySrc[w.source].total++; }
  for (const l of losers) { if (!bySrc[l.source]) bySrc[l.source] = { wins: 0, total: 0 }; bySrc[l.source].total++; }
  for (const [, v] of Object.entries(bySrc)) v.hitRate = v.total > 0 ? Math.round((v.wins / v.total) * 100) : 0;
  return bySrc;
}

function getLearning() { return _learning; }
function getWeights() { return _learning.weights || {}; }

// scoring function: apply learned weights to a candidate
function scoreCandidate(features) {
  const w = _learning.weights || {};
  let bonus = 0;
  const _apply = (feat, val) => {
    const key = feat + ':' + val;
    if (w[key] != null) bonus += w[key];
  };
  _apply('sourceCount', Math.min(features.sourceCount || 1, 3));
  _apply('socialScore', Math.min(features.socialScore || 0, 6));
  _apply('hasWebsite', features.hasWebsite || false);
  _apply('hasTwitter', features.hasTwitter || false);
  _apply('locked', features.locked || false);
  _apply('top10Bucket', (features.top10Pct || 100) < 18 ? 'clean' : (features.top10Pct || 100) < 30 ? 'moderate' : 'heavy');
  _apply('fdvBucket', (features.fdvAtCall || 0) < 50000 ? 'micro' : (features.fdvAtCall || 0) < 200000 ? 'small' : 'mid');
  _apply('rugBucket', (features.rugScore || 0) >= 70 ? 'safe' : (features.rugScore || 0) >= 45 ? 'ok' : 'risky');
  _apply('bundlers', features.bundlers || false);
  _apply('snipers', features.snipers || false);
  return bonus;
}

// ══════════════════════════════════════════════════════════════════════════
//  FAILURE MEMORY — track WHY calls fail, cross-reference, auto-tune
// ══════════════════════════════════════════════════════════════════════════
let _failures = _read(FAILURE_FILE, {
  reasons: {},         // { reason: { count, examples: [] } }
  bySource: {},        // { source: { reason: count } }
  byFdv: {},           // { bucket: { wins, losses } }
  lastUpdated: 0,
});

// Record why a call failed (called by pipeline reject + outcome analysis)
function recordFailure(mint, source, reason, features) {
  const now = Date.now();
  if (!_failures.reasons[reason]) _failures.reasons[reason] = { count: 0, examples: [] };
  _failures.reasons[reason].count++;
  if (_failures.reasons[reason].examples.length < 5) {
    _failures.reasons[reason].examples.push({ mint, source, ts: now, fdv: (features && features.fdvAtCall) || 0 });
  }
  if (!_failures.bySource[source]) _failures.bySource[source] = {};
  _failures.bySource[source][reason] = (_failures.bySource[source][reason] || 0) + 1;
  _failures.lastUpdated = now;
  _write(FAILURE_FILE, _failures);
}

// Analyze post-mortem: classify each losing call by WHY it failed
function analyzeFailures() {
  const losers = _calls.calls.filter(c => c.peakMult < 2 && c.features);
  const reasons = {};
  for (const l of losers) {
    const f = l.features;
    const reason = _classifyFailure(f, l.curMult || 0);
    if (!reasons[reason]) reasons[reason] = { count: 0, avgCurMult: 0, sources: {} };
    reasons[reason].count++;
    reasons[reason].avgCurMult += (l.curMult || 0);
    if (!reasons[reason].sources[l.source]) reasons[reason].sources[l.source] = 0;
    reasons[reason].sources[l.source]++;
  }
  for (const [key, v] of Object.entries(reasons)) {
    if (v.count > 0) v.avgCurMult = Math.round(v.avgCurMult / v.count * 100) / 100;
    else v.avgCurMult = 0;
  }
  _failures.reasons = reasons;
  _failures.lastUpdated = Date.now();
  _write(FAILURE_FILE, _failures);
  return reasons;
}

// Classify WHY a loser failed based on its features
function _classifyFailure(f, curMult) {
  if (curMult <= 0.01) return 'rug_pull';           // dead to zero
  if (curMult < 0.2) return 'severe_dump';          // lost 80%+
  if (curMult < 0.5) return 'major_dump';           // lost 50%+
  if (f && f.rugScore < 30) return 'low_rug_score';  // was risky from start
  if (f && f.holders < 10) return 'no_holders';      // ghost token
  if (f && f.locked === false && f.lpPct < 50) return 'unlocked_lp';  // LP wasn't locked
  if (f && f.bundlers) return 'bundler_dump';        // bundler pattern detected
  if (f && f.snipers) return 'sniper_dump';          // insider/sniper sell-off
  if (f && f.top10Pct > 80) return 'whale_dump';    // top holders dumped
  if (curMult < 0.8) return 'gradual_bleed';        // slow bleed
  return 'stale_call';                               // didn't move enough
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTO-TUNE — suggest filter adjustments based on win/loss patterns
//  Goal: push hit rate toward 50% by tightening losers and loosening winners
// ══════════════════════════════════════════════════════════════════════════
let _autotune = _read(AUTOTUNE_FILE, {
  lastRun: 0,
  suggestions: [],
  adjustments: {},     // { filter: { old, new, reason } }
});

function autoTune() {
  const now = Date.now();
  const wp = _learning.winnerProfile || {};
  const fp = _learning.failureProfile || {};
  const lr = _learning.patterns || {};
  const suggestions = [];

  // ── FDV range optimization ────────────────────────────────────────────
  if (wp.fdv && fp.fdv) {
    const avgWinFdv = wp.fdv;
    const avgLoseFdv = fp.fdv;
    if (avgWinFdv < avgLoseFdv * 0.5) {
      suggestions.push({ filter: 'maxFdv', direction: 'tighten', reason: 'winners avg $' + avgWinFdv + ' vs losers avg $' + avgLoseFdv, confidence: 'high' });
    }
  }

  // ── Rug score optimization ────────────────────────────────────────────
  const rugSafe = lr['rugBucket:safe'] || {};
  const rugOk = lr['rugBucket:ok'] || {};
  const rugRisky = lr['rugBucket:risky'] || {};
  if (rugSafe.wins > 0 && rugRisky.losses > rugRisky.wins * 2) {
    suggestions.push({ filter: 'rugMinScore', direction: 'tighten', reason: 'safe rug: ' + (rugSafe.winRate || 0) + '% vs risky: ' + (rugRisky.winRate || 0) + '%', confidence: 'medium' });
  }

  // ── LP lock analysis ──────────────────────────────────────────────────
  const lpFull = lr['lpBucket:full'] || {};
  const lpNone = lr['lpBucket:none'] || {};
  if (lpFull.wins > 0 && (lpNone.losses || 0) > (lpNone.wins || 0) * 2) {
    suggestions.push({ filter: 'requireLocked', direction: 'keep_strict', reason: 'locked LP winners: ' + (lpFull.winRate || 0) + '%, no lock losers: ' + (lpNone.winRate || 0) + '%', confidence: 'high' });
  }

  // ── Source optimization ───────────────────────────────────────────────
  const bySrc = _learning.hitRateBySource || {};
  for (const [src, v] of Object.entries(bySrc)) {
    if (v.hitRate >= 40 && v.total >= 5) {
      suggestions.push({ filter: src + '_enabled', direction: 'prioritize', reason: src + ' hit rate ' + v.hitRate + '% (' + v.total + ' calls)', confidence: 'high' });
    } else if (v.hitRate < 10 && v.total >= 10) {
      suggestions.push({ filter: src + '_enabled', direction: 'deprioritize', reason: src + ' hit rate only ' + v.hitRate + '% (' + v.total + ' calls)', confidence: 'medium' });
    }
  }

  // ── Holder threshold ──────────────────────────────────────────────────
  const holderMany = lr['holderBucket:many'] || {};
  const holderFew = lr['holderBucket:few'] || {};
  if (holderMany.wins > 0 && holderFew.losses > holderFew.wins * 2) {
    suggestions.push({ filter: 'minHolders', direction: 'raise', reason: '100+ holders win rate: ' + (holderMany.winRate || 0) + '%, <20 holders: ' + (holderFew.winRate || 0) + '%', confidence: 'medium' });
  }

  _autotune = { lastRun: now, suggestions, timestamp: now };
  _write(AUTOTUNE_FILE, _autotune);
  return _autotune;
}

function getAutoTune() { return _autotune; }
function getFailures() { return _failures; }

// ══════════════════════════════════════════════════════════════════════════
//  SOURCE OVERLAP — multi-source confirmation tracking
// ══════════════════════════════════════════════════════════════════════════
let _overlap = _read(OVERLAP_FILE, {});

function recordSource(mint, source, data) {
  const now = Date.now();
  if (!_overlap[mint]) _overlap[mint] = {};
  _overlap[mint][source] = { ts: now, fdv: data.fdv || 0, price: data.price || 0 };
  // cleanup old overlap records (keep 2 hours)
  for (const [k, v] of Object.entries(_overlap[mint])) {
    if (now - v.ts > 2 * 3600 * 1000) delete _overlap[mint][k];
  }
  if (Object.keys(_overlap[mint]).length === 0) delete _overlap[mint];
}

function getOverlap(mint) {
  const now = Date.now();
  const sources = _overlap[mint] || {};
  const active = {};
  for (const [k, v] of Object.entries(sources)) {
    if (now - v.ts < 2 * 3600 * 1000) active[k] = v;   // within 2 hours
  }
  return { sources: active, count: Object.keys(active).length, names: Object.keys(active) };
}

function overlapBonus(mint) {
  const o = getOverlap(mint);
  let bonus = 0;
  if (o.count >= 3) bonus += 20;
  else if (o.count >= 2) bonus += 10;
  if (o.names.includes('dexscreener') && o.names.includes('geckoterminal')) bonus += 5;
  if (o.names.includes('coingecko') && o.names.includes('dexscreener')) bonus += 5;
  return { bonus, ...o };
}

function saveOverlaps() { _write(OVERLAP_FILE, _overlap); }

// ══════════════════════════════════════════════════════════════════════════
//  HISTORICAL STATS — for ZEROX dashboard
// ══════════════════════════════════════════════════════════════════════════
function historicalStats() {
  const calls = _calls.calls;
  const total = calls.length;
  const winners = calls.filter(c => c.peakMult >= 2);
  const losers = calls.filter(c => c.peakMult < 2);
  const bySource = {};
  for (const c of calls) {
    if (!bySource[c.source]) bySource[c.source] = { total: 0, wins: 0 };
    bySource[c.source].total++;
    if (c.peakMult >= 2) bySource[c.source].wins++;
  }
  // feature correlation: what % of winners had website, twitter, etc.
  const winFeatures = {};
  for (const w of winners) {
    if (!w.features) continue;
    if (w.features.hasWebsite) winFeatures.hasWebsite = (winFeatures.hasWebsite || 0) + 1;
    if (w.features.hasTwitter) winFeatures.hasTwitter = (winFeatures.hasTwitter || 0) + 1;
    if (w.features.hasTelegram) winFeatures.hasTelegram = (winFeatures.hasTelegram || 0) + 1;
    if (w.features.locked) winFeatures.locked = (winFeatures.locked || 0) + 1;
    if (w.features.bundlers) winFeatures.bundlers = (winFeatures.bundlers || 0) + 1;
    if (w.features.snipers) winFeatures.snipers = (winFeatures.snipers || 0) + 1;
  }
  // convert to percentages
  for (const [k, v] of Object.entries(winFeatures)) {
    winFeatures[k] = winners.length > 0 ? Math.round((v / winners.length) * 100) : 0;
  }
  return {
    total, winners: winners.length, losers: losers.length,
    hitRate: total > 0 ? Math.round((winners.length / total) * 100) : 0,
    avgPeak: winners.length > 0 ? Math.round(winners.reduce((s, c) => s + c.peakMult, 0) / winners.length * 10) / 10 : 0,
    bySource, winFeatures,
    lastUpdated: Date.now(),
  };
}

// periodic save (every 5 min)
let _saveTimer = null;
function startAutoSave() {
  if (_saveTimer) return;
  _saveTimer = setInterval(() => {
    saveSnapshots();
    saveOverlaps();
    _write(CALLS_FILE, _calls);
    _write(FAILURE_FILE, _failures);
    _write(AUTOTUNE_FILE, _autotune);
  }, 5 * 60 * 1000);
  if (_saveTimer.unref) _saveTimer.unref();
}

module.exports = {
  // snapshots
  upsertSnapshot, getSnapshot, getSnapshots, saveSnapshots,
  // outcomes
  recordOutcome, updateOutcome, getOutcomes, getWinners, getLosers,
  // learning
  analyzeOutcomes, getLearning, getWeights, scoreCandidate,
  // failure memory & auto-tune
  recordFailure, analyzeFailures, autoTune, getAutoTune, getFailures,
  // overlap
  recordSource, getOverlap, overlapBonus, saveOverlaps,
  // stats
  historicalStats,
  // auto-save
  startAutoSave,
};
