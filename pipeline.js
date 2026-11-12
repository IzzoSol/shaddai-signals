/* ══════════════════════════════════════════════════════════════════════════
   pipeline.js — 4-stage signal pipeline:
     1. DISCOVER  — scan providers for new tokens (discovery role only)
     2. CONFIRM   — multi-source overlap scoring (confidence bonus)
     3. VALIDATE  — risk checks on shortlisted candidates (risk role only)
     4. ENRICH    — full metrics + social data for passing tokens

   Designed for 24/7 operation with minimal API usage.
   Providers are polled on staggered schedules, not every cycle.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const providers = require('./providers');
const tokenDb = require('./token-db');
const core = require('./telegram-core');

// ── STAGE TIMERS ────────────────────────────────────────────────────────────
let _timers = { discover: null, context: null };
const DISCOVER_INTERVAL = 20000;    // 20s base for discovery
const CONTEXT_INTERVAL = 120000;    // 2 min for context APIs
const CONFIRM_WINDOW = 3600000;     // 1 hour for multi-source confirmation
const ENRICH_DELAY = 5000;          // 5s delay before enriching a candidate

// ── STATS ───────────────────────────────────────────────────────────────────
const _stats = {
  discovered: 0, confirmed: 0, validated: 0, enriched: 0, posted: 0,
  rejected: 0, lastCycle: 0, cycleCount: 0,
};

// ── CANDIDATE QUEUE ─────────────────────────────────────────────────────────
// Tokens that pass discovery → waiting for confirmation → validation → enrich
const _candidates = new Map();   // mint → { mint, chain, name, symbol, sources: Set, metrics, stage, ts }
const _cooldowns = new Map();    // mint → lastPostTs (prevent re-posting within 30 min)
const COOLDOWN_MS = 30 * 60 * 1000;

// ══════════════════════════════════════════════════════════════════════════
//  STAGE 1: DISCOVER
//  Scan discovery providers on staggered intervals.
//  DexScreener boosts: every 20s (primary)
//  GeckoTerminal new pools: every 30s (secondary)
//  CoinGecko trending: every 60s (tertiary)
// ══════════════════════════════════════════════════════════════════════════
let _lastDex = 0, _lastGt = 0, _lastCg = 0;

async function _discover() {
  const now = Date.now();
  const cfg = core.getConfig();
  if (!cfg.signals && !cfg.newpools && !cfg.trending) return;

  // DexScreener boosts (every 20s)
  if (now - _lastDex >= 20000) {
    _lastDex = now;
    try {
      const boosts = await providers.dexBoosts();
      if (Array.isArray(boosts)) {
        for (const item of boosts) {
          const chain = String(item.chainId || '').toLowerCase();
          const addr = item.tokenAddress;
          if (!addr || !cfg.chains.includes(chain)) continue;
          if (_cooldowns.has(addr) && now - _cooldowns.get(addr) < COOLDOWN_MS) continue;
          _addCandidate(addr, chain, 'dexscreener', { boost: true });
        }
      }
    } catch (e) {}
  }

  // GeckoTerminal new pools (every 30s)
  if (now - _lastGt >= 30000) {
    _lastGt = now;
    for (const chain of cfg.chains) {
      if (!cfg.newpools && !cfg.trending) continue;
      try {
        const kinds = [];
        if (cfg.newpools) kinds.push('new_pools');
        if (cfg.trending) kinds.push('trending_pools');
        for (const kind of kinds) {
          const data = await providers.gtPools(chain, kind);
          const pools = (data && data.data) || [];
          for (const p of pools) {
            const a = p && p.attributes; const id = p && p.id;
            if (!a || !id) continue;
            const bt = (p.relationships && p.relationships.base_token && p.relationships.base_token.data && p.relationships.base_token.data.id) || '';
            const addr = bt.indexOf('_') >= 0 ? bt.slice(bt.indexOf('_') + 1) : bt;
            if (!addr) continue;
            if (_cooldowns.has(addr) && now - _cooldowns.get(addr) < COOLDOWN_MS) continue;
            const fdv = Number(a.fdv_usd) || 0;
            const liq = Number(a.reserve_in_usd) || 0;
            const vol = Number(a.volume_usd && a.volume_usd.h24) || 0;
            if (liq < (cfg.minLiq || 1000) || vol < (cfg.minVol24h || 500)) continue;
            if (cfg.maxFdv && fdv > cfg.maxFdv) continue;
            _addCandidate(addr, chain, 'geckoterminal', { fdv, liq, vol, name: a.name, kind });
          }
        }
      } catch (e) {}
    }
  }

  // CoinGecko trending — DISABLED as a discovery source: it returns no contract address, so its
  // candidates could never confirm (fake 'cg-<symbol>' key) or be risk-checked → un-verifiable ghosts
  // that polluted the candidate queue and learning data. (Kept available via providers.cgTrending() for context only.)

  _stats.discovered = _candidates.size;
}

// ══════════════════════════════════════════════════════════════════════════
//  STAGE 2: CONFIRM
//  Multi-source overlap scoring.
//  If a token appears in 2+ discovery sources within CONFIRM_WINDOW → boost.
// ══════════════════════════════════════════════════════════════════════════
function _addCandidate(mint, chain, source, data) {
  if (!_candidates.has(mint)) {
    _candidates.set(mint, {
      mint, chain, name: data.name || '', symbol: data.symbol || '',
      sources: new Set(), metrics: {}, stage: 'discovered', ts: Date.now(),
      confidence: 0,
    });
  }
  const c = _candidates.get(mint);
  c.sources.add(source);
  c.metrics[source] = data;
  if (data.name && !c.name) c.name = data.name;
  if (data.symbol && !c.symbol) c.symbol = data.symbol;
  // record in token-db for persistence
  tokenDb.recordSource(mint, source, { fdv: data.fdv || 0, price: data.price || 0 });
  tokenDb.upsertSnapshot(mint, { chain, name: c.name, symbol: c.symbol, fdv: data.fdv, source });
  // compute overlap bonus
  const ov = tokenDb.overlapBonus(mint);
  c.confidence = ov.bonus;
  c.sourceCount = ov.count;
  c.sourceNames = ov.names;
  if (c.sourceCount >= 2) c.stage = 'confirmed';
  _stats.confirmed = [..._candidates.values()].filter(x => x.stage === 'confirmed' || x.stage === 'validated').length;
}

function _confirm() {
  const now = Date.now();
  for (const [mint, c] of _candidates) {
    if (c.stage !== 'discovered') continue;
    // check if cooldown
    if (_cooldowns.has(mint) && now - _cooldowns.get(mint) < COOLDOWN_MS) { _candidates.delete(mint); continue; }
    // age out candidates that never got confirmed (15 min)
    if (now - c.ts > 15 * 60 * 1000) { _candidates.delete(mint); continue; }
    // check overlap
    const ov = tokenDb.overlapBonus(mint);
    c.confidence = ov.bonus;
    c.sourceCount = ov.count;
    if (c.sourceCount >= 2) c.stage = 'confirmed';
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  STAGE 3: VALIDATE
//  Risk checks on confirmed candidates (RugCheck, GoPlus, Honeypot).
//  Only runs on Solana tokens. Other chains skip risk checks.
//  Risk APIs are candidate-triggered, then cached 5-30 min.
// ══════════════════════════════════════════════════════════════════════════
async function _validate() {
  const cfg = core.getConfig();
  for (const [mint, c] of _candidates) {
    if (c.stage !== 'confirmed') continue;
    if (c.chain !== 'solana') { _reject(c, 'unsupported chain — cannot risk-check'); continue; }   // fail-closed: only post chains we can verify
    if (!cfg.rugFilter) { c.stage = 'validated'; continue; }

    // RugCheck — PRIMARY risk source. Fail CLOSED: no risk data = no post (was fail-open → rugs slipped through on API errors).
    const rc = await providers.rugReport(mint);
    if (!rc) { _reject(c, 'rugcheck unavailable — fail closed'); continue; }
    if (rc) {
      const score = (rc.score_normalised != null ? rc.score_normalised : rc.score) || 0;
      const risks = rc.risks || [];
      const danger = risks.filter(x => String(x.level || '').toLowerCase() === 'danger').length;
      const topHolders = rc.topHolders || [];
      const top10Pct = topHolders.slice(0, 10).reduce((s, h) => s + (Number(h.pct) || 0), 0);
      const topHolderPct = Number((topHolders[0] && topHolders[0].pct)) || 0;
      const insiders = topHolders.filter(h => h.insider).length;
      // bundler clusters: top holders with suspiciously similar amounts (batch/bundle buys)
      let bundlerClusters = 0;
      const _bAmts = topHolders.slice(0, 10).map(h => Number(h.amount) || 0).filter(a => a > 0).sort((a, b) => b - a);
      for (let i = 0; i < _bAmts.length - 1; i++) { const ratio = _bAmts[i] > 0 ? _bAmts[i + 1] / _bAmts[i] : 0; if (ratio > 0.85 && ratio < 1.15) bundlerClusters++; }
      let lpPct = 0, lpDataPresent = false;
      try { const m = (rc.markets || [])[0]; if (m && m.lp) { lpDataPresent = true; lpPct = Number((m.lp.lpLockedPct != null ? m.lp.lpLockedPct : m.lp.lpLocked) || 0); } } catch (e) {}
      const holders = Number(rc.totalHolders || 0);

      c.metrics.rugScore = score;
      c.metrics.top10Pct = top10Pct;
      c.metrics.topHolderPct = topHolderPct;
      c.metrics.insiders = insiders;
      c.metrics.bundlers = bundlerClusters > 0;
      c.metrics.lpPct = lpPct;
      c.metrics.holders = holders;
      c.metrics.dangerRisks = danger;

      // apply filters — HARD REJECTS (locked liq, sniper/bundler cap under 10%)
      if (score < (cfg.rugMinScore || 45)) { _reject(c, 'rug score ' + score + ' < ' + (cfg.rugMinScore || 45)); continue; }
      if ((holders || 0) < (cfg.minHolders || 5)) { _reject(c, 'holders ' + (holders || 0) + ' < ' + (cfg.minHolders || 5)); continue; }   // missing holder data = reject
      // OWNER MUST-RULE: liquidity locked & not removable — fail-closed BUT re-checkable:
      // If RugCheck has no LP data yet (brand-new pool), defer to next cycle instead of hard-rejecting
      if (cfg.requireLocked) {
        if (!lpDataPresent) {
          // brand-new pool — RugCheck hasn't indexed LP data yet. Don't hard-reject; re-check next cycle.
          if (!c._lpRetries) c._lpRetries = 0;
          c._lpRetries++;
          if (c._lpRetries < 6) { console.log('[pipeline] DEFERRED ' + (c.symbol || c.mint) + ' — no LP lock data yet (retry ' + c._lpRetries + '/6)'); continue; }
          // after 6 retries (~2 min at 20s cycle), still no data — reject
          _reject(c, 'LP lock data unavailable after 6 retries'); continue;
        }
        if (lpPct < 80) { _reject(c, 'LP locked ' + lpPct.toFixed(0) + '% < 80%'); continue; }
      }
      // OWNER RULE: top holder must be < 30% unless LP is locked
      if (topHolderPct > 30 && lpPct < 50) { _reject(c, 'top holder ' + topHolderPct.toFixed(1) + '% (unlocked)'); continue; }
      // OWNER RULE: sniper/insider share of SUPPLY must be under the cap (was count/holders — almost never tripped)
      const insiderSupplyPct = topHolders.filter(h => h.insider).reduce((s, h) => s + (Number(h.pct) || 0), 0);
      if (cfg.maxSnipersPct && insiderSupplyPct >= cfg.maxSnipersPct) { _reject(c, 'insider supply ' + insiderSupplyPct.toFixed(1) + '% >= ' + cfg.maxSnipersPct + '%'); continue; }
      // risk bonus
      if (score >= 70 && danger === 0) c.confidence += 10;
    }

    // ── GoPlus cross-check (2nd risk source, fail-open) ──────────────────────
    // Hard-reject unambiguous honeypots; penalize soft authority risks; bonus trusted tokens.
    try {
      const gp = await providers.gpSecurity(c.chain, mint);
      const sec = gp && gp.result && gp.result[mint];
      if (sec) {
        const _s = (o) => (o && typeof o === 'object') ? o.status === '1' : String(o) === '1';
        const honeypot = _s(sec.non_transferable);
        const balMutable = _s(sec.balance_mutable_authority);
        const mintable = _s(sec.mintable);
        const freezable = _s(sec.freezable);
        c.metrics.goplus = { honeypot, balMutable, mintable, freezable, trusted: Number(sec.trusted_token) === 1 };
        // holders fallback from GoPlus when RugCheck gave none
        if ((!c.metrics.holders || c.metrics.holders === 0) && sec.holder_count) c.metrics.holders = Number(sec.holder_count) || 0;
        if (honeypot) { _reject(c, 'GoPlus: non-transferable (honeypot)'); continue; }
        if (balMutable) { _reject(c, 'GoPlus: balance-mutable authority (rug vector)'); continue; }
        // OWNER MUST-RULE: "not removable" — mint & freeze authority must be revoked.
        if (mintable) { _reject(c, 'GoPlus: mint authority active (supply dilutable)'); continue; }
        if (freezable) { _reject(c, 'GoPlus: freeze authority active (can lock holders out)'); continue; }
        if (c.metrics.goplus.trusted) c.confidence += 5;   // GoPlus-verified token
      }
    } catch (e) {}

    c.stage = 'validated';
  }
  _stats.validated = [..._candidates.values()].filter(x => x.stage === 'validated' || x.stage === 'enriched').length;
}

function _reject(c, reason) {
  c.stage = 'rejected';
  _stats.rejected++;
  _cooldowns.set(c.mint, Date.now());
  console.log(`[pipeline] REJECTED ${c.symbol || c.mint}: ${reason}`);
  // log failure for ZEROX learning — track WHY tokens get rejected
  try { require('./token-db').recordFailure(c.mint, (c.metrics && c.metrics.source) || 'pipeline', reason, c.metrics); } catch (e) {}
}

// ══════════════════════════════════════════════════════════════════════════
//  STAGE 4: ENRICH
//  Full metrics + social data for validated tokens.
//  Returns the final signal card data for posting.
// ══════════════════════════════════════════════════════════════════════════
async function _enrich() {
  const cfg = core.getConfig();
  const results = [];
  for (const [mint, c] of _candidates) {
    if (c.stage !== 'validated') continue;
    // get full DexScreener data
    const ds = await providers.dexToken(c.chain, mint);
    if (ds && ds.pairs && ds.pairs.length > 0) {
      const pair = ds.pairs.sort((a, b) => (b.liquidity && b.liquidity.usd || 0) - (a.liquidity && a.liquidity.usd || 0))[0];
      c.metrics.price = Number(pair.priceUsd) || 0;
      c.metrics.fdv = Number(pair.fdv || pair.marketCap) || c.metrics.fdv || 0;
      c.metrics.vol24h = Number(pair.volume && pair.volume.h24) || 0;
      c.metrics.liq = Number(pair.liquidity && pair.liquidity.usd) || 0;
      c.metrics.change24h = Number(pair.priceChange && pair.priceChange.h24) || 0;
      c.metrics.url = pair.url || '';
      if (pair.baseToken) {
        if (pair.baseToken.name && !c.name) c.name = pair.baseToken.name;
        if (pair.baseToken.symbol && !c.symbol) c.symbol = pair.baseToken.symbol;
      }
    }

    // apply learned weights from ZEROX
    const learnBonus = tokenDb.scoreCandidate({
      sourceCount: c.sourceCount || 1,
      socialScore: (cfg.minSocialScore || 0),
      hasWebsite: false, hasTwitter: false,
      locked: c.metrics.lpPct >= 99,
      top10Pct: c.metrics.top10Pct || 100,
      bundlers: c.metrics.bundlers || false, snipers: (c.metrics.insiders || 0) > 0,
      rugScore: c.metrics.rugScore || 0,
      fdvAtCall: c.metrics.fdv || 0,
    });
    c.confidence += learnBonus;

    // holder conviction score (pure module) — the 0-100 conviction line shown on cards
    try {
      c.conviction = require('./lib/conviction').convictionScore({
        holderCount: c.metrics.holders || 0,
        topHolderPct: c.metrics.topHolderPct || 0,
        top10Pct: c.metrics.top10Pct || 0,
        whales: [],
      });
    } catch (e) {}

    // holder count bonus — more holders = more bullish
    const holderCount = c.metrics.holders || 0;
    if (holderCount >= 200) c.confidence += 8;
    else if (holderCount >= 100) c.confidence += 5;
    else if (holderCount >= 50) c.confidence += 3;

    // final filters
    if (!c.metrics.fdv || c.metrics.fdv <= 0) { _reject(c, 'unknown mcap — cannot size'); continue; }   // no mcap = no post
    if (cfg.maxFdv && c.metrics.fdv > cfg.maxFdv) { _reject(c, 'fdv $' + (c.metrics.fdv/1000).toFixed(0) + 'K > $' + (cfg.maxFdv/1000).toFixed(0) + 'K'); continue; }
    if (cfg.minLiq && c.metrics.liq < cfg.minLiq) { _reject(c, 'liq $' + c.metrics.liq.toFixed(0) + ' < $' + cfg.minLiq); continue; }
    // OWNER RULE: liquidity must "match" the token — ≥ minLiqPct% of mcap (thin book vs big mcap = drainable)
    if (cfg.minLiqPct && (c.metrics.liq / c.metrics.fdv * 100) < cfg.minLiqPct) { _reject(c, 'liq ' + (c.metrics.liq / c.metrics.fdv * 100).toFixed(1) + '% of mcap < ' + cfg.minLiqPct + '%'); continue; }
    if (cfg.minVol24h && c.metrics.vol24h < cfg.minVol24h) { _reject(c, 'vol $' + c.metrics.vol24h.toFixed(0) + ' < $' + cfg.minVol24h); continue; }
    if (cfg.bullishOnly && c.metrics.change24h < -10) { _reject(c, 'bearish ' + c.metrics.change24h.toFixed(0) + '%'); continue; }

    c.stage = 'enriched';
    c.finalConfidence = c.confidence;
    results.push(c);
  }
  // rank best calls first so the maxPer cutoff keeps the highest-confidence runners, not arbitrary Map order
  results.sort((a, b) => (b.finalConfidence || 0) - (a.finalConfidence || 0));
  _stats.enriched = results.length;
  return results;
}

// ══════════════════════════════════════════════════════════════════════════
//  MAIN CYCLE — runs all 4 stages
// ══════════════════════════════════════════════════════════════════════════
let _running = false;
async function _cycle() {
  if (_running) return;
  _running = true;
  try {
    _stats.lastCycle = Date.now();
    _stats.cycleCount++;
    await _discover();
    _confirm();
    await _validate();
    const enriched = await _enrich();
    // return enriched candidates for posting
    return enriched;
  } finally {
    _running = false;
  }
}

function getStats() { return Object.assign({}, _stats, { candidates: _candidates.size, cooldowns: _cooldowns.size }); }
function getCandidates() {
  const out = [];
  for (const [, c] of _candidates) {
    out.push({
      mint: c.mint, chain: c.chain, name: c.name, symbol: c.symbol,
      stage: c.stage, confidence: c.confidence, sourceCount: c.sourceCount,
      sourceNames: c.sourceNames, ts: c.ts, metrics: c.metrics,
    });
  }
  return out;
}
function addCooldown(mint) { _cooldowns.set(mint, Date.now()); }

module.exports = { _cycle, getStats, getCandidates, addCooldown };
