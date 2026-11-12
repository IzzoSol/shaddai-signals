/* ══════════════════════════════════════════════════════════════════════════
   providers.js — Multi-source provider registry with health, rate-limiting,
   circuit-breakers, and per-provider TTL caching.

   ROLES:
     discovery  — pair/token discovery (DexScreener, GeckoTerminal, CoinGecko)
     risk       — security/rug checks (RugCheck, GoPlus, Honeypot.is)
     context    — market overview/pulse (CoinLore, CoinPaprika, DefiLlama)

   DESIGN:
     - Never poll every API every cycle
     - Discovery APIs: short intervals (20-60s)
     - Risk APIs: candidate-triggered, cache 5-30 min
     - Context APIs: slow intervals (60-300s) or on-demand
     - All responses cached with per-provider TTLs
     - Circuit-breaker: if provider fails 3x, cool down 5 min
     - Rate-limit tracking per provider
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

// ── CACHE ───────────────────────────────────────────────────────────────────
const _cache = new Map();   // key → { data, expires }
function _cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) { _cache.delete(key); return null; }
  return e.data;
}
function _cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expires: Date.now() + ttlMs });
  // periodic cleanup: evict expired entries
  if (_cache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of _cache) { if (now > v.expires) _cache.delete(k); }
  }
}
function cacheStats() {
  let hits = 0, misses = 0, entries = 0;
  const now = Date.now();
  for (const [, v] of _cache) { entries++; if (now <= v.expires) hits++; else misses++; }
  return { entries, active: _cache.size };
}

// ── PROVIDER REGISTRY ───────────────────────────────────────────────────────
const providers = {};

/**
 * Register a provider.
 * @param {Object} cfg
 *   name, role, baseUrl, ttlMs, intervalMs, maxPerMin, timeoutMs
 */
function register(cfg) {
  providers[cfg.name] = {
    name: cfg.name,
    role: cfg.role,            // discovery | risk | context
    baseUrl: cfg.baseUrl || '',
    ttlMs: cfg.ttlMs || 60000,
    intervalMs: cfg.intervalMs || 60000,
    maxPerMin: cfg.maxPerMin || 30,
    timeoutMs: cfg.timeoutMs || 10000,
    enabled: cfg.enabled !== false,
    // health state
    _ok: 0,
    _fail: 0,
    _lastOk: 0,
    _lastFail: 0,
    _circuitOpen: false,
    _circuitUntil: 0,
    _requests: [],          // timestamps of recent requests (for rate tracking)
    _lastRequest: 0,
    // stats
    _calls: 0,
    _cacheHits: 0,
    _cacheMisses: 0,
    _avgMs: 0,
    _totalMs: 0,
  };
}

// ── HEALTH / CIRCUIT-BREAKER ────────────────────────────────────────────────
function _recordOk(name, ms) {
  const p = providers[name]; if (!p) return;
  p._ok++; p._fail = 0; p._lastOk = Date.now();
  p._calls++; p._totalMs += ms; p._avgMs = Math.round(p._totalMs / p._calls);
  p._circuitOpen = false; p._circuitUntil = 0;
}
function _recordFail(name) {
  const p = providers[name]; if (!p) return;
  p._fail++; p._lastFail = Date.now(); p._calls++;
  if (p._fail >= 3) {
    p._circuitOpen = true;
    p._circuitUntil = Date.now() + 5 * 60 * 1000;   // 5 min cooldown
    console.warn(`[providers] ${name} circuit OPEN — cooling down 5 min after ${p._fail} consecutive failures`);
  }
}
function _isAvailable(name) {
  const p = providers[name]; if (!p) return false;
  if (!p.enabled) return false;
  if (p._circuitOpen && Date.now() < p._circuitUntil) return false;
  if (p._circuitOpen && Date.now() >= p._circuitUntil) { p._circuitOpen = false; p._fail = 0; }   // recovery
  // rate limit: maxPerMin
  const now = Date.now();
  p._requests = p._requests.filter(t => now - t < 60000);
  if (p._requests.length >= p.maxPerMin) return false;
  return true;
}
function _trackRequest(name) {
  const p = providers[name]; if (!p) return;
  p._requests.push(Date.now());
  p._lastRequest = Date.now();
}

// ── FETCH WITH TIMEOUT + CIRCUIT ────────────────────────────────────────────
async function _fetch(name, url, opts) {
  const p = providers[name]; if (!p) throw new Error('Unknown provider: ' + name);
  if (!_isAvailable(name)) return null;   // circuit open or rate-limited
  const cacheKey = name + ':' + url;
  const cached = _cacheGet(cacheKey);
  if (cached !== null) { p._cacheHits++; return cached; }
  p._cacheMisses++;
  _trackRequest(name);
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), p.timeoutMs);
    const r = await fetch(url, Object.assign({ signal: ctrl.signal, headers: { 'Accept': 'application/json', 'User-Agent': 'SHADDAI/1.0' } }, opts || {}));
    clearTimeout(timer);
    if (!r.ok) { _recordFail(name); return null; }
    const data = await r.json();
    const ms = Date.now() - start;
    _recordOk(name, ms);
    _cacheSet(cacheKey, data, p.ttlMs);
    return data;
  } catch (e) {
    _recordFail(name);
    return null;
  }
}

// ── PUBLIC API ──────────────────────────────────────────────────────────────
function status() {
  return Object.values(providers).map(p => ({
    name: p.name, role: p.role, enabled: p.enabled,
    ok: p._ok, fail: p._fail, calls: p._calls,
    circuitOpen: p._circuitOpen,
    circuitUntil: p._circuitUntil > Date.now() ? new Date(p._circuitUntil).toISOString() : null,
    avgMs: p._avgMs, cacheHits: p._cacheHits, cacheMisses: p._cacheMisses,
    lastOk: p._lastOk ? new Date(p._lastOk).toISOString() : null,
    lastFail: p._lastFail ? new Date(p._lastFail).toISOString() : null,
    ratePerMin: p._requests.filter(t => Date.now() - t < 60000).length,
    maxPerMin: p.maxPerMin,
    ttlMs: p.ttlMs, intervalMs: p.intervalMs,
  }));
}
function enable(name, v) { if (providers[name]) providers[name].enabled = v !== false; }
function resetCircuit(name) { const p = providers[name]; if (p) { p._circuitOpen = false; p._fail = 0; p._circuitUntil = 0; } }

// ══════════════════════════════════════════════════════════════════════════
//  PROVIDER IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════════

// ── 1. DexScreener — primary pair discovery + live metrics ──────────────────
register({ name: 'dexscreener', role: 'discovery', baseUrl: 'https://api.dexscreener.com', ttlMs: 30000, intervalMs: 20000, maxPerMin: 20, timeoutMs: 8000 });

async function dexBoosts() { return _fetch('dexscreener', 'https://api.dexscreener.com/token-boosts/latest/v1') || []; }
async function dexToken(chain, addr) { return _fetch('dexscreener', `https://api.dexscreener.com/latest/dex/tokens/${addr}`); }
async function dexSearch(q) { return _fetch('dexscreener', `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`); }

// ── 2. GeckoTerminal — secondary discovery + pool metrics ──────────────────
register({ name: 'geckoterminal', role: 'discovery', baseUrl: 'https://api.geckoterminal.com', ttlMs: 45000, intervalMs: 30000, maxPerMin: 20, timeoutMs: 10000 });

const GT_NET = { solana: 'solana', base: 'base', eth: 'eth', ethereum: 'eth', bsc: 'bsc', polygon: 'polygon_pos', arbitrum: 'arbitrum', avax: 'avax' };
async function gtPools(chain, kind, page) {
  const net = GT_NET[chain]; if (!net) return [];
  return _fetch('geckoterminal', `https://api.geckoterminal.com/api/v2/networks/${net}/${kind || 'new_pools'}?page=${page || 1}`) || { data: [] };
}

// ── 3. CoinGecko — trending + market data ──────────────────────────────────
register({ name: 'coingecko', role: 'discovery', baseUrl: 'https://api.coingecko.com', ttlMs: 90000, intervalMs: 60000, maxPerMin: 10, timeoutMs: 10000 });

async function cgTrending() { return _fetch('coingecko', 'https://api.coingecko.com/api/v3/search/trending'); }
async function cgCoin(id) { return _fetch('coingecko', `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`); }

// ── 4. RugCheck — Solana risk filter ───────────────────────────────────────
register({ name: 'rugcheck', role: 'risk', baseUrl: 'https://api.rugcheck.xyz', ttlMs: 300000, intervalMs: 0, maxPerMin: 15, timeoutMs: 9000 });

async function rugReport(mint) { return _fetch('rugcheck', `https://api.rugcheck.xyz/v1/tokens/${mint}/report`); }
async function rugSummary(mint) { return _fetch('rugcheck', `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`); }

// ── 5. GoPlus — contract/security risk (multi-chain) ──────────────────────
register({ name: 'goplus', role: 'risk', baseUrl: 'https://api.gopluslabs.io', ttlMs: 300000, intervalMs: 0, maxPerMin: 10, timeoutMs: 8000 });

async function gpSecurity(chain, addr) {
  // Solana uses a dedicated endpoint; EVM chains use numeric chain IDs on the generic one.
  if (chain === 'solana' || chain === 'sol') return _fetch('goplus', `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${addr}`);
  const chainId = { eth: '1', ethereum: '1', bsc: '56', base: '8453', polygon: '137', arbitrum: '42161', avax: '43114' }[chain] || '1';
  return _fetch('goplus', `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${addr}`);
}

// ── 6. Honeypot.is — honeypot + holder risk ───────────────────────────────
register({ name: 'honeypot', role: 'risk', baseUrl: 'https://api.honeypot.is', ttlMs: 300000, intervalMs: 0, maxPerMin: 10, timeoutMs: 8000 });

async function hpCheck(chain, addr) {
  const chainId = { solana: 'solana', eth: 'ethereum', base: 'base', bsc: 'bsc' }[chain] || 'ethereum';
  return _fetch('honeypot', `https://api.honeypot.is/v2/IsHoneypot?address=${addr}&chainId=${chainId}`);
}

// ── 7. CoinLore — no-key market overview + global pulse ───────────────────
register({ name: 'coinlore', role: 'context', baseUrl: 'https://api.coinlore.net', ttlMs: 120000, intervalMs: 60000, maxPerMin: 10, timeoutMs: 8000 });

async function clGlobal() { return _fetch('coinlore', 'https://api.coinlore.net/api/global/'); }
// Live market regime (risk-on / risk-off) from CoinLore global — cached via the registry TTL.
async function marketRegime() {
  try {
    const g = await clGlobal();
    const row = Array.isArray(g) ? g[0] : g;
    if (!row) return null;
    const chg = Number(row.mcap_change);
    if (!isFinite(chg)) return null;
    const risk = chg <= -2 ? 'off' : chg >= 2 ? 'on' : 'neutral';
    return { risk, mcapChg: chg, btcDom: Number(row.btc_d) || 0, label: risk === 'off' ? '🥶 Risk-off' : risk === 'on' ? '🔥 Risk-on' : '😐 Neutral' };
  } catch (e) { return null; }
}
async function clTickers(ids) { return _fetch('coinlore', `https://api.coinlore.net/api/tickers/?id=${ids || '0,1,2,3,2710'}`); }

// ── 8. CoinPaprika — fallback ticker/search/history ───────────────────────
register({ name: 'coinpaprika', role: 'context', baseUrl: 'https://api.coinpaprika.com', ttlMs: 120000, intervalMs: 120000, maxPerMin: 10, timeoutMs: 8000 });

async function cpSearch(q) { return _fetch('coinpaprika', `https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(q)}&limit=5`); }
async function cpTicker(id) { return _fetch('coinpaprika', `https://api.coinpaprika.com/v1/tickers/${id}`); }

// ── 9. DefiLlama — macro market context only ──────────────────────────────
register({ name: 'defillama', role: 'context', baseUrl: 'https://api.llama.fi', ttlMs: 600000, intervalMs: 300000, maxPerMin: 5, timeoutMs: 10000 });

async function dlTvl(protocol) { return _fetch('defillama', `https://api.llama.fi/tvl/${protocol}`); }
async function dlOverview() { return _fetch('defillama', 'https://api.llama.fi/v2/chains'); }

module.exports = {
  // registry
  register, status, enable, resetCircuit, cacheStats,
  // fetch helper (for custom calls)
  fetch: _fetch,
  // discovery
  dexBoosts, dexToken, dexSearch,
  gtPools,
  cgTrending, cgCoin,
  // context
  marketRegime,
  // risk
  rugReport, rugSummary,
  gpSecurity,
  hpCheck,
  // context
  clGlobal, clTickers,
  cpSearch, cpTicker,
  dlTvl, dlOverview,
  // cache
  cacheGet: _cacheGet, cacheSet: _cacheSet,
};
