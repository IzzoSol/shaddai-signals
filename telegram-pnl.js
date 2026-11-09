/* ══════════════════════════════════════════════════════════════════════════
   telegram-pnl.js — call performance tracker.
   • recordCall(): logs each posted signal's entry (mcap/FDV, price, time).
   • startTracker(): re-prices tracked calls, tracks peak multiple ("Xs"), and
     auto-posts milestone WINS (2x/5x/10x…) to the channel — winners funnel.
   • stats(period): daily/weekly/monthly hit-rate + best calls (public teaser;
     full per-call PNL incl. misses is the Pro view).
   Uses the FREE DexScreener tokens endpoint (batched). Metric = FDV/mcap.
   Persists to backend/data/tg-calls.json. Fail-safe.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('./telegram-core');
let pnlImages; try { pnlImages = require('./lib/pnl-images'); } catch (e) { pnlImages = null; }

const DATA_DIR = process.env.TG_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'tg-calls.json');
const BOT_DIR = path.join(__dirname, '..', 'public', 'assets', 'bot');
const MILESTONES_DIR = path.join(BOT_DIR, 'milestones');
// pick a random existing PNL celebration image (pnl-1..10.png) or null
function _pnlImage() {
  try {
    const imgs = [];
    for (let i = 1; i <= 10; i++) { const f = path.join(BOT_DIR, 'pnl-' + i + '.png'); if (fs.existsSync(f)) imgs.push(f); }
    if (!imgs.length) return null;
    return imgs[Math.floor(Math.random() * imgs.length)];
  } catch (e) { return null; }
}
// milestone image: returns themed image for 2x,5x,10x,15x,20x,25x,30x,35x,40x,45x,50x
const MILESTONE_LEVELS = [2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
function milestoneImage(mult) {
  const m = Math.floor(Number(mult) || 0);
  // find the highest milestone image <= current mult
  let best = 0;
  for (const lvl of MILESTONE_LEVELS) { if (m >= lvl) best = lvl; }
  if (!best) return null;
  const f = path.join(MILESTONES_DIR, 'milestone-' + best + 'x.png');
  return fs.existsSync(f) ? f : null;
}
// get PNL image for /pnl command: use milestone image if at milestone, else random pnl image
function _pnlImageForCall(call) {
  const m = Math.floor(Number(call.curMult || call.peakMult || 0));
  const msImg = milestoneImage(m);
  if (msImg) return msImg;
  return _pnlImage();
}
const DS_TOKENS = (addrs) => `https://api.dexscreener.com/latest/dex/tokens/${addrs}`;
const MILESTONES = [2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];   // every milestone level
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;   // stop tracking after 30 days
const _esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function _usd(n) { const v = Number(n) || 0; if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'; return '$' + v.toFixed(0); }
function _ago(ts) { const s = Math.max(0, (nowMs() - ts) / 1000); if (s < 3600) return Math.round(s / 60) + 'm'; if (s < 86400) return Math.round(s / 3600) + 'h'; return Math.round(s / 86400) + 'd'; }
function nowMs() { return _now; }
let _now = 0;   // stamped per tick (Date.now unavailable in some sandboxes; set on each call)

function _read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { calls: [] }; } }
// Atomic write (temp-file + rename) so a crash mid-write can't truncate/corrupt
// tg-calls.json and silently wipe the call history.
function _write(o) { try { const d = path.dirname(FILE); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 2)); fs.renameSync(tmp, FILE); } catch (e) { try { console.warn('[tg-pnl] write failed:', e && e.message); } catch (_) {} } }

let _state = _read();

// Calculate comprehensive risk score (0-100, higher = riskier)
function _calcRiskScore(c) {
  let risk = 30;  // baseline

  // Top 10 concentration penalty
  const top10 = Number(c.top10Pct) || 0;
  if (top10 > 50) risk += 25;
  else if (top10 > 40) risk += 15;
  else if (top10 > 30) risk += 8;

  // Insider/sniper presence
  if (c.insiders > 0) risk += (Math.min(c.insiders, 5) * 3);
  if (c.snipers) risk += 12;
  if (c.bundlers) risk += 10;

  // LP lock status (good indicator)
  const lpPct = Number(c.lpPct) || 0;
  if (lpPct < 50) risk += 20;
  else if (lpPct < 70) risk += 8;
  else if (lpPct >= 90) risk -= 10;  // heavily locked = safer

  // Liquidity ratio
  const fdv = Number(c.entryFdv) || 1;
  const liqRatio = fdv > 0 ? ((Number(c.liq) || 0) / fdv) * 100 : 0;
  if (liqRatio < 1) risk += 15;
  else if (liqRatio < 2) risk += 8;
  else if (liqRatio > 15) risk -= 5;  // good liquidity

  // Volume metrics
  const vol24 = Number(c.vol24) || 0;
  const vol1h = Number(c.vol1h) || 0;
  if (vol24 < 10000) risk += 10;  // low volume
  if (vol1h > 0 && vol24 > 0 && (vol1h / vol24) > 0.3) risk -= 5;  // good volume acceleration

  // Holder count indicator
  const holders = Number(c.holders) || 0;
  if (holders < 100) risk += 12;
  else if (holders < 500) risk += 6;
  else if (holders > 5000) risk -= 5;

  // Cap at 0-100 range
  return Math.max(0, Math.min(100, risk));
}

// Calculate viability score (0-100, higher = better quality signal)
function _calcViabilityScore(c) {
  let score = 50;

  // Source reputation boost
  const srcBonus = { trending: 5, bonded: 10, boosted: 3, helius: 4, gecko: 2, pipeline: 6 };
  score += (srcBonus[c.source] || 0);

  // LP locked bonus (strong indicator)
  const lpPct = Number(c.lpPct) || 0;
  if (lpPct >= 90) score += 15;
  else if (lpPct >= 70) score += 8;

  // Liquidity quality
  const fdv = Number(c.entryFdv) || 1;
  const liqRatio = fdv > 0 ? ((Number(c.liq) || 0) / fdv) * 100 : 0;
  if (liqRatio >= 10) score += 12;
  else if (liqRatio >= 3) score += 6;

  // Holder diversity
  const holders = Number(c.holders) || 0;
  if (holders >= 5000) score += 10;
  else if (holders >= 1000) score += 6;
  else if (holders >= 500) score += 3;

  // Volume momentum
  const vol24 = Number(c.vol24) || 0;
  if (vol24 >= 100000) score += 8;
  else if (vol24 >= 50000) score += 4;

  // Cap at 0-100
  return Math.max(0, Math.min(100, score));
}

// Log a fresh call (dedupe: one active entry per mint).
function recordCall(c) {
  try {
    _now = Date.now();
    const mint = c && (c.mint || c.address);
    const entry = Number(c && (c.entryFdv || c.entryMcap)) || 0;
    if (!mint || entry <= 0) return;                       // need a mint + a starting mcap to compute Xs
    if (_state.calls.some(x => x.mint === mint && !x.closed)) return;   // already tracking

    // Calculate risk and viability scores
    const riskScore = _calcRiskScore(c);
    const viabilityScore = _calcViabilityScore(c);

    // Calculate key ratios
    const fdv = Number(c.entryFdv) || 1;
    const liq = Number(c.liq) || 0;
    const holders = Number(c.holders) || 0;
    const vol24 = Number(c.vol24) || 0;

    const callRecord = {
      mint, chain: (c.chain || '').toLowerCase(), name: c.name || '', symbol: c.symbol || '',
      source: c.source || '', entryFdv: entry, entryPrice: Number(c.entryPrice) || 0,
      // Risk metrics
      riskScore, viabilityScore,
      // On-chain metrics
      holders, liq, vol1h: Number(c.vol1h) || 0, vol24,
      top10Pct: Number(c.top10Pct) || 0,
      lpPct: Number(c.lpPct) || 0,
      insiders: Number(c.insiders) || 0,
      bundlers: !!c.bundlers,
      snipers: !!c.snipers,
      rugScore: Number(c.rugScore) || 0,
      rank: Number(c.rank) || 0,
      // Wallet intelligence: trimmed top holders (owner wallet + pct) captured at call time.
      // Consumed by the Pro-Signals Wallet Intelligence panel + tail-wallet cross-reference.
      topHolders: (c.topHolders || []).slice(0, 20).map(h => ({
        owner: String(h.owner || '').slice(0, 64),
        pct: Math.round((Number(h.pct) || 0) * 100) / 100,
        uiAmount: Number(h.uiAmount) || 0,
        insider: !!h.insider,
      })),
      // Calculated ratios
      liqRatio: fdv > 0 ? ((liq / fdv) * 100).toFixed(2) : 0,
      holderDensity: holders > 0 ? (fdv / holders).toFixed(0) : 0,
      vol24Ratio: vol24 > 0 ? ((vol24 / fdv) * 100).toFixed(2) : 0,
      // Tracking
      ts: _now, peakMult: 1, curMult: 1, curFdv: entry, milestones: [], closed: false,
    };

    _state.calls.push(callRecord);
    if (_state.calls.length > 5000) _state.calls = _state.calls.slice(-5000);
    _write(_state);

    // Also log to token-db for ZEROX learning (bridge the two databases)
    try { require('./token-db').recordOutcome(c); } catch (e) { console.warn('[pnl] token-db recordOutcome error:', e.message); }
  } catch (e) { console.warn('[pnl] recordCall error:', e.message); }
}

async function _priceMap(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const r = await fetch(DS_TOKENS(batch.join(',')));
      if (!r.ok) continue;
      const j = await r.json();
      (j && j.pairs || []).forEach(p => {
        const addr = p.baseToken && p.baseToken.address;
        const fdv = Number(p.fdv || p.marketCap || 0);
        if (!addr || !fdv) return;
        if (!out[addr] || fdv > out[addr]) out[addr] = fdv;   // keep the richest pair
      });
    } catch (e) {}
  }
  return out;
}

function _milestoneCard(call, x) {
  const confirmedRunner = x === 5 && call.milestones && call.milestones.includes(2)
    ? '\n\n📈 <b>CONFIRMED RUNNER</b> — hit 2nd milestone. Historically these continue higher.' : '';
  const laterMilestones = call.milestones && call.milestones.length > 1
    ? `\n🎯 Hit milestones: ${call.milestones.map(m => m + 'x').join(' → ')}` : '';
  return (
    `🎯 <b>${x}x WIN</b> 🚀\n` +
    `<b>$${_esc(call.symbol || call.name || 'TOKEN')}</b> is up <b>${x}x</b> since our CALL (${_ago(call.ts)} ago)\n\n` +
    `━━ 📊 PNL ━━\n` +
    `Entry: <b>${_usd(call.entryFdv)}</b>\n` +
    `Now:   <b>${_usd(call.curFdv)}</b>\n` +
    `Peak:  <b>${x}x</b>` + laterMilestones + confirmedRunner +
    `\n\n📡 Live calls: ${core.channel() || '@ShaddaiLabs'}`
  );
}

async function trackTick() {
  const HAS_BOT = !!core.token();
  _now = Date.now();
  const active = _state.calls.filter(c => !c.closed && (_now - c.ts) < MAX_AGE_MS);
  if (!active.length) return;
  const prices = await _priceMap([...new Set(active.map(c => c.mint))]);
  let changed = false;
  for (const call of active) {
    const cur = prices[call.mint];
    let hit = 0;
    if (cur) {
      call.curFdv = cur;
      call.curMult = cur / call.entryFdv;
      if (call.curMult > call.peakMult) {
        call.peakMult = call.curMult; changed = true;
        // feed the new peak into token-db so ZEROX learning has real win/loss outcomes (closes the loop)
        try { require('./token-db').updateOutcome(call.mint, { peakMult: call.peakMult, curMult: call.curMult, curFdv: call.curFdv }); } catch (e) { console.warn('[pnl] updateOutcome error:', e.message); }
      }
      // fire the LOWEST uncrossed milestone first — progressive alerts (2x, then 5x, then 10x…)
      // Never skip straight to 5x just because the token moved fast between ticks.
      if (HAS_BOT) {
        for (const m of MILESTONES) {
          if (call.peakMult >= m && !call.milestones.includes(m)) { hit = m; break; }   // lowest first, stop
        }
        if (hit) {
          call.milestones.push(hit);   // record only the one being fired; next tick fires the next
          changed = true;
          const img = milestoneImage(hit) || _pnlImage();
          const btns = core.buildButtons(call.mint, call.chain || 'solana', null, { pnl: true });
          if (img) await core.broadcastPhoto(img, _milestoneCard(call, hit), btns);
          else await core.broadcast(_milestoneCard(call, hit), { buttons: btns });
        }
      }

      // Slow climber updates removed — channel posts wins (milestones) only.
    }

    // Rug alerts and round-trip alerts removed — wins only channel.
  }
  if (changed) _write(_state);
  // Rug prune: calls whose LIVE fdv ≤ $4k for >1h disappear (only when we have a live price)
  try { pruneRugs(4000, 1, prices); } catch (e) {}
  // auto-prune aged losers → keeps the public scoreboard winners-fresh
  try { if (core.getConfig().autoPrune !== false) pruneLosers(1.5, 6); } catch (e) {}
}

// ── stats: daily / weekly / monthly ─────────────────────────────────────────
function stats(period) {
  _now = Date.now();
  const span = period === 'week' ? 7 : period === 'month' ? 30 : 1;
  const since = _now - span * 24 * 3600 * 1000;
  const rows = _state.calls.filter(c => c.ts >= since && c.source !== 'seed');
  const total = rows.length;
  const hits2 = rows.filter(c => c.peakMult >= 2).length;
  const hits5 = rows.filter(c => c.peakMult >= 5).length;
  const hits10 = rows.filter(c => c.peakMult >= 10).length;
  const hitRate = total ? Math.round((hits2 / total) * 100) : 0;
  const avgPeak = total ? (rows.reduce((s, c) => s + (c.peakMult || 0), 0) / total).toFixed(1) : '0';
  const best = rows.slice().sort((a, b) => b.peakMult - a.peakMult).slice(0, 5);
  const label = period === 'week' ? 'WEEKLY' : period === 'month' ? 'MONTHLY' : 'DAILY';
  const bestTxt = best.length
    ? best.map(c => `• <b>$${_esc(c.symbol || c.name || '?')}</b> — <b>${c.peakMult.toFixed(1)}x</b>`).join('\n')
    : '• (no calls in range yet)';
  // Per-source breakdown
  const sources = ['bonded', 'new_pools', 'trending', 'boosted'];
  const srcLines = sources.map(src => {
    const s = rows.filter(c => c.source === src);
    if (!s.length) return null;
    const r2 = s.filter(c => c.peakMult >= 2).length;
    const r5 = s.filter(c => c.peakMult >= 5).length;
    return `  ${src.padEnd(10)} ${String(s.length).padStart(3)} calls · 2x: ${Math.round(r2/s.length*100)}% · 5x: ${Math.round(r5/s.length*100)}%`;
  }).filter(Boolean).join('\n');
  const ch = core.channel() || '@ShaddaiLabs';
  return (
    `📊 <b>SHADDAI ${label} SCORECARD</b>\n\n` +
    `Calls: <b>${total}</b>  ·  2x: <b>${hits2}</b> (<b>${hitRate}%</b>)  ·  5x: <b>${hits5}</b>  ·  10x+: <b>${hits10}</b>\n` +
    `Avg peak: <b>${avgPeak}x</b>\n\n` +
    (srcLines ? `<b>By source</b>\n<pre>${srcLines}</pre>\n\n` : '') +
    `🏆 <b>Best ${label.toLowerCase()}</b>\n${bestTxt}\n\n` +
    `📡 ${_esc(ch)}  ·  <i>NFA. Track your own entries.</i>`
  );
}

// ── /pnl card: a random polished image + a branded best-calls scoreboard ─────
function pnlImage() { return _pnlImage(); }
function pnlCaption(period) {
  _now = Date.now();
  const span = period === 'month' ? 30 : period === 'all' ? 3650 : 7;
  const since = _now - span * 24 * 3600 * 1000;
  const rows = _state.calls.filter(c => c.ts >= since);
  const best = rows.slice().filter(c => c.symbol || c.name).sort((a, b) => b.peakMult - a.peakMult).slice(0, 6);
  const hits = rows.filter(c => c.peakMult >= 2).length;
  const hitRate = rows.length ? Math.round((hits / rows.length) * 100) : 0;
  const ch = core.channel() || '@ShaddaiLabs';
  const bestTxt = best.length
    ? best.map(c => `• <b>$${_esc(c.symbol || c.name || '?')}</b> — <b>${c.peakMult.toFixed(1)}x</b>`).join('\n')
    : '• (calls are being tracked — check back soon)';
  return (
    `📊 <b>SHADDAI PNL</b> · ${_esc(ch)}\n\n` +
    `🏆 <b>Best calls</b>\n${bestTxt}\n\n` +
    `Hit rate: <b>${hitRate}%</b>  ·  Calls tracked: <b>${rows.length}</b>\n` +
    `📡 Live calls: ${_esc(ch)}\n<i>Not financial advice. DYOR.</i>`
  );
}

// /pnl <token> — a card for one specific tracked call
function pnlForToken(q) {
  _now = Date.now();
  const s = String(q || '').toLowerCase().replace(/^\$/, '').trim(); if (!s) return null;
  const c = _state.calls.find(x => (x.symbol || '').toLowerCase() === s || (x.name || '').toLowerCase() === s || (x.mint || '').toLowerCase() === s)
    || _state.calls.find(x => (x.symbol || '').toLowerCase().includes(s) || (x.name || '').toLowerCase().includes(s));
  if (!c) return null;
  const ch = core.channel() || '@ShaddaiLabs';
  const realMint = c.mint && !String(c.mint).startsWith('seed-');
  return (
    `📊 <b>PNL — $${_esc(c.symbol || c.name || '?')}</b>\n\n` +
    `Entry: <b>${_usd(c.entryFdv)}</b>\nNow: <b>${_usd(c.curFdv || c.entryFdv)}</b>\n` +
    `Peak: <b>${c.peakMult.toFixed(1)}x</b>  ·  Current: <b>${(c.curMult || 1).toFixed(1)}x</b>\n` +
    `Called: ${_ago(c.ts)} ago\n` +
    (realMint ? `📋 CA: <code>${_esc(c.mint)}</code>\n` : '') +
    `\n📡 ${_esc(ch)}  ·  <i>Not financial advice.</i>`
  );
}

// hourly PERFORMANCE distribution: 1-2x / 2-5x / 5-10x / 10x+ + top performers
function distribution() {
  _now = Date.now();
  const rows = _state.calls;
  const total = rows.length;
  const inB = (lo, hi) => rows.filter(c => c.peakMult >= lo && (hi ? c.peakMult < hi : true)).length;
  const b12 = inB(1, 2), b25 = inB(2, 5), b510 = inB(5, 10), b10 = inB(10, 0);
  const hits = b25 + b510 + b10;
  const hitRate = total ? Math.round((hits / total) * 100) : 0;
  const avg = total ? (rows.reduce((s, c) => s + c.peakMult, 0) / total) : 0;
  const top = rows.slice().filter(c => c.symbol || c.name).sort((a, b) => b.peakMult - a.peakMult).slice(0, 250);
  const ch = core.channel() || '@ShaddaiLabs';
  // Show as many top performers as fit — Telegram hard-caps a message at 4096 chars, so build the
  // list up to a safe budget (leaves room for the header/footer) then note how many more there are.
  let topTxt = '', shown = 0;
  for (const c of top) {
    const line = `• <b>$${_esc(c.symbol || c.name)}</b> — <b>${c.peakMult.toFixed(1)}x</b>\n`;
    if (topTxt.length + line.length > 3600) break;
    topTxt += line; shown++;
  }
  if (!shown) topTxt = '• (tracking…)\n';
  if (top.length > shown) topTxt += `…and ${top.length - shown} more\n`;
  topTxt = topTxt.replace(/\n+$/, '');
  return (
    `📊 <b>SHADDAI PERFORMANCE</b> · ${_esc(ch)}\n\n` +
    `<b>Distribution</b> (${total} calls)\n` +
    `🟡 1–2x: <b>${b12}</b>\n🟢 2–5x: <b>${b25}</b>\n🔥 5–10x: <b>${b510}</b>\n🚀 10x+: <b>${b10}</b>\n\n` +
    `✅ Hit rate (2x+): <b>${hitRate}%</b>  ·  Avg peak: <b>${avg.toFixed(1)}x</b>\n\n` +
    `🏆 <b>Top performers</b>\n${topTxt}\n\n` +
    `📡 ${_esc(ch)}  ·  <i>Not financial advice. DYOR.</i>`
  );
}

// ── CONVICTION HOLDS ("held well") — long-term survivors from the day/week before ──
// A coin that ran 10x and still holds 7x (70% retention) is more bullish than one that
// ran 10x and fell to 3x (30%). Ranks by current gain weighted by how well it held its ATH.
// Only includes calls still in the GREEN (survived — didn't round-trip to zero).
function survivors(period) {
  _now = Date.now();
  const wk = period === 'week';
  const minAge = wk ? 24 * 3600 * 1000 : 12 * 3600 * 1000;         // day view: 12h+ old · week view: 1d+ old
  const maxAge = wk ? 9 * 24 * 3600 * 1000 : 3 * 24 * 3600 * 1000; // week view: up to ~9d · day view: up to 3d
  const scored = _state.calls
    .filter(c => { if (c.source === 'seed') return false; const age = _now - c.ts; return age >= minAge && age <= maxAge && (c.curMult || 1) >= 1; })  // live survivors only, still green
    .map(c => {
      const peak = c.peakMult || 1, cur = c.curMult || 1;
      const retention = peak > 0 ? cur / peak : 0;                 // how much of ATH it holds
      const holderBoost = 1 + Math.min(0.5, (c.holders || 0) / 1000);   // real-holder conviction: up to +50% at 1000+ holders
      const held = cur * (0.4 + 0.6 * retention) * holderBoost;    // current gain, boosted by ATH retention + holder base
      return { c, peak, cur, retention, held };
    })
    .sort((a, b) => b.held - a.held)
    .slice(0, 25);
  const ch = core.channel() || '@ShaddaiLabs';
  const label = wk ? 'WEEK' : 'DAY';
  if (!scored.length) {
    return `💎 <b>SHADDAI CONVICTION HOLDS — ${label}</b>\n\n<i>No surviving calls in range yet — check back once calls mature.</i>\n\n📡 ${_esc(ch)}`;
  }
  const lines = scored.map(s => {
    const sym = _esc(s.c.symbol || s.c.name || '?');
    const ret = Math.round(s.retention * 100);
    const bar = ret >= 70 ? '🟢' : ret >= 40 ? '🟡' : '🟠';
    const hold = s.c.holders ? ` · 👥 ${s.c.holders}` : '';
    const ca = s.c.mint && !String(s.c.mint).startsWith('seed-') ? `\n   <code>${_esc(s.c.mint)}</code>` : '';
    return `${bar} <b>$${sym}</b> — now <b>${s.cur.toFixed(1)}x</b> · ATH ${s.peak.toFixed(1)}x · held <b>${ret}%</b>${hold} · ${_ago(s.c.ts)}${ca}`;
  }).join('\n');
  return (
    `💎 <b>SHADDAI CONVICTION HOLDS — ${label}</b>\n` +
    `<i>Calls still in the green, ranked by how well they held their ATH</i>\n` +
    `━━━━━━━━━━━━━\n` +
    lines +
    `\n\n🟢 held ATH well  ·  🟡 pulled back  ·  🟠 deep retrace\n` +
    `📡 ${_esc(ch)}  ·  <i>Real holder conviction — long-term survivors. NFA.</i>`
  );
}

// manually add a (historical) winning call — locked/closed so it isn't re-priced
function seedCall(o) {
  _now = Date.now();
  const peak = Number(o.peakMult) || 1;
  const entry = Number(o.entryFdv || o.entryMcap) || 20000;
  _state.calls.push({
    mint: o.mint || ('seed-' + (o.symbol || 'x') + '-' + _state.calls.length), chain: o.chain || 'solana',
    name: o.name || o.symbol || '', symbol: o.symbol || o.name || '', source: 'seed',
    entryFdv: entry, entryPrice: 0, ts: _now - (Number(o.daysAgo) || 1) * 24 * 3600 * 1000,
    peakMult: peak, curMult: peak, curFdv: entry * peak, milestones: [], closed: true,
  });
  _write(_state);
  return true;
}

let _timer = null, _digestTimer = null, _heldTimer = null, _discoverTimer = null;
function startTracker() {
  if (_timer) return;
  const HAS_BOT = !!core.token();
  if (HAS_BOT && typeof core.acquireBroadcastLock === 'function' && !core.acquireBroadcastLock()) { console.log('[tg-pnl] another instance owns broadcasting — tracker not started here.'); return; }
  console.log('[tg-pnl] call tracker armed — re-pricing + ' + (HAS_BOT ? 'milestone wins.' : 'no-bot live reprice + rug-prune (no broadcasting).'));
  setTimeout(() => { trackTick().catch(() => {}); }, 12000);
  _timer = setInterval(() => { trackTick().catch(() => {}); }, 8 * 60000);   // every 8 min
  if (_timer.unref) _timer.unref();
  if (!HAS_BOT) return;   // digest + survivors only broadcast when the bot is live
  // hourly performance distribution digest (with a polished image)
  let lastD = Date.now();
  _digestTimer = setInterval(() => {
    const cfg = core.getConfig(); if (cfg.digest === false) return;
    const everyMs = Math.max(30, cfg.digestIntervalMin || 60) * 60000;
    if (Date.now() - lastD >= everyMs) { lastD = Date.now(); const img = _pnlImage(); const cap = distribution(); (img ? core.broadcastPhoto(img, cap) : core.broadcast(cap)).catch(() => {}); }
  }, 60000);
  if (_digestTimer.unref) _digestTimer.unref();
  // conviction holds — auto-post long-term survivors on its own cadence (default hourly). Stays QUIET when none.
  let lastH = Date.now();
  _heldTimer = setInterval(() => {
    const cfg = core.getConfig(); if (cfg.heldPost === false) return;
    const everyMs = Math.max(30, cfg.heldIntervalMin || 60) * 60000;
    if (Date.now() - lastH >= everyMs) {
      lastH = Date.now();
      const cap = survivors('day');
      if (cap.includes('No surviving calls')) return;   // nothing matured yet — don't spam an empty card
      const img = _pnlImage();
      (img ? core.broadcastPhoto(img, cap) : core.broadcast(cap)).catch(() => {});
    }
  }, 60000);
  if (_heldTimer.unref) _heldTimer.unref();
}

// Discovery — stream new Solana tokens into the public feed on Render when the bot
// is offline. Uses DexScreener token-boosts (community-promoted new launches), filtered
// to small/mid FDV with meaningful liquidity, deduped + capped (≤6/tick, 10-min cadence).
async function discoverTick() {
  _now = Date.now();
  try {
    const r = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return 0;
    const boosts = await r.json();
    if (!Array.isArray(boosts)) return 0;
    const sol = boosts.filter(b => b.chainId === 'solana' && b.tokenAddress);
    let added = 0;
    for (const b of sol.slice(0, 50)) {
      if (added >= 6) break;
      const mint = b.tokenAddress;
      if (_state.calls.some(x => x.mint === mint)) continue;           // already tracked
      let fdv = 0, price = 0, liq = 0, sym = b.symbol || b.token || '', nm = b.name || '';
      try {
        const pr = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint, { signal: AbortSignal.timeout(8000) });
        const pj = await pr.json();
        const p = (pj.pairs || []).find(x => x.chainId === 'solana') || (pj.pairs || [])[0];
        if (p) {
          fdv = Number(p.fdv || p.marketCap || 0) || 0;
          price = Number((p.priceNative !== undefined ? p.priceNative : p.priceUsd)) || 0;
          liq = Number((p.liquidity && p.liquidity.usd) || 0);
          sym = (p.baseToken && p.baseToken.symbol) || sym;
          nm = (p.baseToken && p.baseToken.name) || nm;
        }
      } catch (e) {}
      if (fdv <= 2000 || fdv > 250000) continue;                        // only small/mid new launches
      if (liq > 0 && liq < 2000) continue;                             // need real liquidity (skip proxy/zero-liq)
      recordCall({ mint, chain: 'solana', symbol: sym, name: nm, source: 'boosted', entryFdv: fdv, entryPrice: price, liq, holders: 0 });
      added++;
    }
    if (added > 0) { try { _write(_state); } catch (e) {} console.log('[tg-pnl] discovery +' + added + ' new boosted solana call(s).'); }
    return added;
  } catch (e) { return 0; }
}
function startDiscovery() {
  if (_discoverTimer) return;
  if ((process.env.DISCOVERY || '1') === '0') { console.log('[tg-pnl] discovery disabled (DISCOVERY=0).'); return; }
  console.log('[tg-pnl] discovery armed — streaming new boosted Solana calls every 10m (capped 6/tick).');
  setTimeout(() => { discoverTick().catch(() => {}); }, 30000);
  _discoverTimer = setInterval(() => { discoverTick().catch(() => {}); }, 10 * 60000);
  if (_discoverTimer.unref) _discoverTimer.unref();
}

function resetCalls() { _state = { calls: [] }; _write(_state); }

// Remove "bad" calls — aged calls that never reached minPeak. Keeps seeds, winners,
// and young calls (they still have time to run). Powers the winners-fresh public feed.
function pruneLosers(minPeak, minAgeHours) {
  _now = Date.now();
  const mp = Number(minPeak) || 1.5;
  const ageMs = (Number(minAgeHours) || 6) * 3600 * 1000;
  const before = _state.calls.length;
  _state.calls = _state.calls.filter(c => c.source === 'seed' || c.peakMult >= mp || (_now - c.ts) < ageMs);
  const removed = before - _state.calls.length;
  if (removed > 0) _write(_state);
  return removed;
}

// Rug prune — remove calls whose LIVE fdv dropped to a rug floor (eg $4k) for more than
// a minimum age. Only pruned when we actually have a live price confirming the rug; calls
// we could not re-price are kept (no evidence they rugged). Keeps seeds + young calls.
function pruneRugs(maxFdv, minAgeHours, prices) {
  _now = Date.now();
  const mf = Number(maxFdv) || 4000;
  const ageMs = (Number(minAgeHours) || 1) * 3600 * 1000;
  const before = _state.calls.length;
  _state.calls = _state.calls.filter(c => {
    if (c.source === 'seed') return true;
    if ((_now - c.ts) < ageMs) return true;                        // too young — give it time
    const live = (prices && prices[c.mint] != null) ? prices[c.mint] : null;
    if (live != null) return live > mf;                            // confirmed live price → keep if above rug floor
    if (typeof c.curFdv === 'number' && c.curFdv > 0) return c.curFdv > mf;  // last known live price
    return true;                                                    // no live price → can't confirm a rug → keep
  });
  const removed = before - _state.calls.length;
  if (removed > 0) _write(_state);
  return removed;
}

// /pnl <CA> save — generate a PNL snapshot image on demand and return it
async function savePnlSnapshot(q) {
  _now = Date.now();
  const s = String(q || '').toLowerCase().replace(/^\$/, '').trim();
  if (!s) return { error: 'No token provided.' };
  const c = _state.calls.find(x => (x.mint || '').toLowerCase() === s)
    || _state.calls.find(x => (x.symbol || '').toLowerCase() === s || (x.name || '').toLowerCase() === s)
    || _state.calls.find(x => (x.symbol || '').toLowerCase().includes(s) || (x.name || '').toLowerCase().includes(s));
  if (!c) return { error: 'No tracked call found for <b>' + _esc(s) + '</b>.' };

  const mult = Number(c.peakMult || c.curMult || 1);
  const symbol = c.symbol || c.name || 'TOKEN';
  const img = await pnlImages.generatePnlImage(c);
  const ch = core.channel() || '@ShaddaiLabs';
  const cap = (
    `📊 <b>PNL SNAPSHOT — $${_esc(symbol)}</b>\n\n` +
    `Entry: <b>${_usd(c.entryFdv)}</b>\n` +
    `ATH: <b>${mult.toFixed(1)}x</b>  →  <b>${_usd(c.entryFdv * mult)}</b>\n` +
    `Current: <b>${(c.curMult || 1).toFixed(1)}x</b>\n` +
    (c.mint && !String(c.mint).startsWith('seed-') ? `📋 CA: <code>${_esc(c.mint)}</code>\n` : '') +
    `\n📡 ${_esc(ch)}  ·  <i>Saved PNL snapshot.</i>`
  );
  return { img, cap, symbol, mult };
}

// find a previously saved PNL image for a token (no generation)
function savedPnlImage(q) {
  const s = String(q || '').toLowerCase().replace(/^\$/, '').trim();
  if (!s) return null;
  const GENERATED_DIR = path.join(__dirname, '..', 'public', 'assets', 'bot', 'pnl-generated');
  try {
    if (!fs.existsSync(GENERATED_DIR)) return null;
    const files = fs.readdirSync(GENERATED_DIR);
    const match = files.find(f => f.toLowerCase().includes(s));
    if (match) return path.join(GENERATED_DIR, match);
  } catch (e) {}
  return null;
}

// find a call by ticker/name/mint (for /pnl image lookup)
function _findCall(q) {
  _now = Date.now();
  const s = String(q || '').toLowerCase().replace(/^\$/, '').trim();
  if (!s) return null;
  return _state.calls.find(x => (x.symbol || '').toLowerCase() === s || (x.name || '').toLowerCase() === s || (x.mint || '').toLowerCase() === s)
    || _state.calls.find(x => (x.symbol || '').toLowerCase().includes(s) || (x.name || '').toLowerCase().includes(s));
}

// /last<N> — the last N calls with their live PNL (newest first). Length-guarded
// to Telegram's 4096-char cap; shows as many as fit then "…and N more".
function lastCalls(n) {
  _now = Date.now();
  const N = Math.min(100, Math.max(1, parseInt(n, 10) || 25));
  const rows = _state.calls.filter(c => c.symbol || c.name).slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, N);
  const ch = core.channel() || '@ShaddaiLabs';
  if (!rows.length) return `📄 <b>Last ${N} calls</b>\n\n(no calls tracked yet)`;
  let body = '', shown = 0;
  for (const c of rows) {
    const sym = _esc(c.symbol || c.name || 'TOKEN');
    const cur = Number(c.curMult || 1), peak = Number(c.peakMult || 1);
    const emoji = peak >= 10 ? '🚀' : peak >= 5 ? '🔥' : peak >= 2 ? '🟢' : cur < 0.5 ? '💀' : '🟡';
    const entryFdv = c.entryFdv ? ` ·in $${c.entryFdv >= 1000 ? (c.entryFdv/1000).toFixed(0)+'K' : c.entryFdv}` : '';
    const age = c.ts ? ` · ${_ago(c.ts)}` : '';
    const line = `${emoji} <b>$${sym}</b> — now <b>${cur.toFixed(1)}x</b> · ATH <b>${peak.toFixed(1)}x</b>${entryFdv}${age}\n`;
    if (body.length + line.length > 3600) break;
    body += line; shown++;
  }
  const more = rows.length > shown ? `\n…and ${rows.length - shown} more` : '';
  return `📄 <b>LAST ${shown} CALLS</b> · ${_esc(ch)}\n\n${body}${more}\n\n📡 ${_esc(ch)}  ·  <i>Not financial advice. DYOR.</i>`;
}

// /active — currently live calls (not rugged, <72h old, still above 0.4x), sorted by current gain.
// Helps subscribers know what's still worth watching right now.
function activeCalls() {
  _now = Date.now();
  const MAX_AGE = 72 * 3600 * 1000;   // 72h window — beyond that, treat as closed
  const rows = _state.calls
    .filter(c => {
      if (!c.ts || c.source === 'seed') return false;
      if (_now - c.ts > MAX_AGE) return false;
      if ((c.curMult || 1) < 0.4) return false;   // assume rugged
      return true;
    })
    .sort((a, b) => (b.curMult || 1) - (a.curMult || 1));
  const ch = core.channel() || '@ShaddaiLabs';
  if (!rows.length) {
    return `⚡ <b>ACTIVE CALLS</b> · ${_esc(ch)}\n\n<i>No live calls in the last 72h. Fresh plays incoming.</i>\n\n📡 ${_esc(ch)}`;
  }
  let body = '', shown = 0;
  for (const c of rows) {
    const sym = _esc(c.symbol || c.name || 'TOKEN');
    const cur = Number(c.curMult || 1), peak = Number(c.peakMult || 1);
    const emoji = cur >= 2 ? '🟢' : cur >= 1 ? '⚡' : '🟡';
    const pct = Math.round((cur - 1) * 100);
    const pctStr = pct >= 0 ? `+${pct}%` : `${pct}%`;
    const entryFdv = c.entryFdv ? ` ·in $${c.entryFdv >= 1000 ? (c.entryFdv/1000).toFixed(0)+'K' : c.entryFdv}` : '';
    const ca = c.mint && !String(c.mint).startsWith('seed-') ? `\n   <code>${_esc(c.mint)}</code>` : '';
    const line = `${emoji} <b>$${sym}</b>  <b>${pctStr}</b> (${cur.toFixed(2)}x) · ATH ${peak.toFixed(1)}x${entryFdv} · ${_ago(c.ts)}${ca}\n`;
    if (body.length + line.length > 3600) break;
    body += line; shown++;
  }
  return (
    `⚡ <b>ACTIVE CALLS</b> (${shown}/${rows.length} live) · ${_esc(ch)}\n` +
    `<i>Last 72h · sorted by current gain · not rugged</i>\n` +
    `━━━━━━━━━━━━━\n` +
    body +
    `\n📡 ${_esc(ch)}  ·  <i>NFA. Always DYOR.</i>`
  );
}

// ── PUBLIC API JSON accessors ────────────────────────────────────────────────
// Clean, developer-friendly JSON over the tracked calls (used by /api/v1/*).
// Deliberately separate from the HTML formatters above — no markup, stable shape.
function _shape(c) {
  return {
    id: (c.mint || '') + '-' + (c.ts || 0),
    symbol: c.symbol || c.name || '',
    mint: c.mint || '',
    chain: c.chain || '',
    source: c.source || '',
    rank: Number(c.rank) || 0,
    entryFdv: Number(c.entryFdv) || 0,
    entryPrice: Number(c.entryPrice) || 0,
    currentMult: Number((c.curMult || 1).toFixed ? +Number(c.curMult || 1).toFixed(4) : c.curMult) || 1,
    peakMult: +Number(c.peakMult || 1).toFixed(4),
    ts: c.ts || 0,
  };
}
function _clampLimit(v) { const n = parseInt(v, 10); return Math.min(2000, Math.max(1, isFinite(n) ? n : 50)); }
// Recent calls feed. opts: { limit, since(ms cursor), chain, source }
function callsJson(opts) {
  opts = opts || {}; _now = Date.now();
  let rows = _state.calls.slice();
  if (opts.chain) { const c = String(opts.chain).toLowerCase(); rows = rows.filter(x => (x.chain || '').toLowerCase() === c); }
  if (opts.source) { const s = String(opts.source).toLowerCase(); rows = rows.filter(x => (x.source || '').toLowerCase() === s); }
  const since = Number(opts.since) || 0;
  if (since > 0) rows = rows.filter(x => (x.ts || 0) > since);
  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return rows.slice(0, _clampLimit(opts.limit)).map(_shape);
}
// Top calls by peak multiple. opts: { limit, period(all|week|day) }
function leaderboardJson(opts) {
  opts = opts || {}; _now = Date.now();
  let rows = _state.calls.filter(c => c.symbol || c.name);
  if (opts.period === 'day' || opts.period === 'week') {
    const ms = (opts.period === 'week' ? 7 : 1) * 24 * 3600 * 1000;
    rows = rows.filter(c => (_now - (c.ts || 0)) <= ms);
  }
  rows.sort((a, b) => (b.peakMult || 0) - (a.peakMult || 0));
  return rows.slice(0, _clampLimit(opts.limit)).map(_shape);
}
// Aggregate scorecard.
function statsJson() {
  _now = Date.now();
  const rows = _state.calls; const total = rows.length;
  const inB = (lo, hi) => rows.filter(c => c.peakMult >= lo && (hi ? c.peakMult < hi : true)).length;
  const x1_2 = inB(1, 2), x2_5 = inB(2, 5), x5_10 = inB(5, 10), x10 = inB(10, 0);
  const hits = x2_5 + x5_10 + x10;
  return {
    totalCalls: total,
    hitRate2x: total ? Math.round((hits / total) * 100) : 0,
    avgPeak: total ? +(rows.reduce((s, c) => s + (c.peakMult || 0), 0) / total).toFixed(2) : 0,
    distribution: { x1_2, x2_5, x5_10, x10 },
    updatedAt: _now,
  };
}
// Single-token lookup by mint or symbol.
function findTokenJson(q) {
  _now = Date.now();
  const s = String(q || '').toLowerCase().replace(/^\$/, '').trim();
  if (!s) return { called: false };
  const c = _state.calls.find(x => (x.mint || '').toLowerCase() === s)
    || _state.calls.find(x => (x.symbol || '').toLowerCase() === s || (x.name || '').toLowerCase() === s)
    || _state.calls.find(x => (x.symbol || '').toLowerCase().includes(s));
  if (!c) return { called: false };
  return Object.assign({ called: true }, _shape(c));
}

module.exports = { recordCall, trackTick, stats, startTracker, startDiscovery, discoverTick, pnlImage, pnlCaption, resetCalls, pnlForToken, distribution, seedCall, pruneLosers, pruneRugs, savePnlSnapshot, savedPnlImage, milestoneImage, survivors, _findCall, callsJson, leaderboardJson, statsJson, findTokenJson, lastCalls, activeCalls, pnlImages, _calcRiskScore, _calcViabilityScore };
function _byPeriod(calls,unit){const m={};calls.forEach(c=>{if(!c.ts)return;const d=new Date(c.ts);let k;if(unit==='hour') k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0');else if(unit==='day') k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');else if(unit==='month') k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');else k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');m[k]=(m[k]||{calls:0,hits2x:0,totalGainPct:0});const mult=c.peakMult||c.exitMult||1;if(mult>=2)m[k].hits2x++;m[k].calls++;m[k].totalGainPct+=(c.gainPct||0);});const out={};Object.keys(m).sort().forEach(k=>{m[k].hitRate=Math.round((m[k].hits2x/m[k].calls)*100);m[k].avgGain=Math.round((m[k].totalGainPct/m[k].calls)*10)/10;out[k]=m[k];});return out;}
