/* ══════════════════════════════════════════════════════════════════════════
   telegram-core.js — shared Telegram layer used by the bot, signals & news.
   • Chat registry (persisted) so we can broadcast to EVERY chat the bot is in
     (DMs, groups, channels) plus the configured main channel.
   • send() / broadcast() helpers.
   • Runtime config (toggles + intervals) the dashboard can read/update.
   SECURITY: token from env only. Fail-safe: no-op without a token; never throws.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.TG_DATA_DIR || path.join(__dirname, 'data');   // set to a Render persistent-disk path (paid plan) to survive redeploys
const CHATS_FILE = path.join(DATA_DIR, 'tg-chats.json');
const CFG_FILE = path.join(DATA_DIR, 'tg-config.json');
const ALERTED_FILE = path.join(DATA_DIR, 'tg-alerted.json');
const ALERT_TTL = 30 * 24 * 3600 * 1000;   // re-alert a coin at most once per 30 days
const TG = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

function _ensure() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function _read(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function _write(f, o) { try { _ensure(); fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) {} }

function token() { return process.env.TELEGRAM_BOT_TOKEN || ''; }
function channel() { return process.env.TELEGRAM_CHANNEL || ''; }

// ── chat registry ──────────────────────────────────────────────────────────
let _chats = _read(CHATS_FILE, {});   // { id: {id, type, title, at} }
function addChat(chat) {
  if (!chat || chat.id == null) return;
  const id = String(chat.id);
  if (!_chats[id]) { _chats[id] = { id: chat.id, type: chat.type || '', title: chat.title || chat.username || chat.first_name || '', at: Date.now() }; _write(CHATS_FILE, _chats); }
}
function removeChat(id) { const k = String(id); if (_chats[k]) { delete _chats[k]; _write(CHATS_FILE, _chats); } }
function chats() { return Object.values(_chats); }

// ── GLOBAL de-dupe: one alert per coin across ALL sources (persisted, TTL) ──
let _alerted = _read(ALERTED_FILE, {});   // { mintLower: ts }
function wasAlerted(mint) {
  const k = String(mint == null ? '' : mint).toLowerCase(); if (!k) return false;
  const ts = _alerted[k]; if (!ts) return false;
  if (Date.now() - ts > ALERT_TTL) { delete _alerted[k]; return false; }
  return true;
}
function markAlerted(mint) {
  const k = String(mint == null ? '' : mint).toLowerCase(); if (!k) return;
  _alerted[k] = Date.now();
  const keys = Object.keys(_alerted);
  if (keys.length > 8000) { keys.map(x => [x, _alerted[x]]).sort((a, b) => a[1] - b[1]).slice(0, 2000).forEach(([x]) => delete _alerted[x]); }
  _write(ALERTED_FILE, _alerted);
}
function resetAlerted() { _alerted = {}; _write(ALERTED_FILE, _alerted); }

// ── SINGLE-BROADCASTER LOCK ─────────────────────────────────────────────────
// Guarantees only ONE process ever broadcasts (kills duplicate sends from a 2nd
// instance — e.g. a dev server + a standalone stack). A live lock heartbeats every
// 30s; a stale one (>90s) is taken over.
const LOCK_FILE = path.join(DATA_DIR, 'tg-lock.json');
const _lockId = 'lk-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
let _lockAcquired = false;
function acquireBroadcastLock() {
  if (_lockAcquired) return true;
  try {
    const cur = _read(LOCK_FILE, null);
    if (cur && cur.id !== _lockId && (Date.now() - (cur.ts || 0)) < 90000) return false;   // another live broadcaster
    _ensure(); fs.writeFileSync(LOCK_FILE, JSON.stringify({ id: _lockId, ts: Date.now() }));
    _lockAcquired = true;
    const hb = setInterval(() => { try { fs.writeFileSync(LOCK_FILE, JSON.stringify({ id: _lockId, ts: Date.now() })); } catch (e) {} }, 30000);
    if (hb.unref) hb.unref();
    return true;
  } catch (e) { return true; }
}

// ── runtime config (dashboard-editable) ─────────────────────────────────────
const _defaults = {
  // feed toggles — tuned to what actually wins (trending/bonded had 0% hit rate)
  signals: true,          // DexScreener trending/boosts
  bonded: true,           // pump.fun graduations — RE-ENABLED with upgraded feed (advanced-api holders/snipers/dev% + DexScreener USD enrich + locked-liq gate)
  newpools: true,         // GeckoTerminal brand-new pools — main winner source
  trending: false,        // GeckoTerminal trending — had 0% hit rate, disabled
  news: true,             // market pulse (mcap/dominance/BTC-ETH-SOL)
  newsIntervalMin: 120,   // every 2h (was hourly — was posting too often)
  headlines: true,        // free RSS crypto news headlines (CoinTelegraph/CoinDesk)
  headlinesIntervalMin: 45,
  promo: true,            // periodic SHADDAI project promo (bio, GitHub star-for-giveaway, socials)
  promoIntervalMin: 240,  // every 4h
  digest: true,           // hourly performance distribution (1-2x/2-5x/5-10x/10x+ + top performers)
  digestIntervalMin: 60,
  heldPost: true,         // auto-post "conviction holds" (long-term survivors that held their ATH)
  heldIntervalMin: 60,    // every 1h
  autoPrune: false,       // keep honest hit-rate (owner) — don't silently drop losers
  // filter parameters — DEFAULT: sniper_seed preset (best win rate, 50% on seed calls)
  chains: 'solana',       // comma list: solana,base,eth,bsc,…
  minLiq: 2000,           // min pair/pool liquidity USD (catch micro-caps early)
  minVol24h: 1000,        // min 24h volume USD (fresh coins start low)
  minFdv: 5000,           // min fully-diluted valuation USD — hard floor in telegram-signals keeps this ≥$5K (weekday/peak/weekend); tuned from corpus: 2-15K band wins 36-44%, 50K+ only ~17%
  maxFdv: 50000,          // max mcap $50K — corpus shows 50K+ entry has the worst win rate (~17%), so cut it
  maxPer: 5,              // max posts per poll per source (more coverage for micro-caps)
  rugFilter: true,        // Solana: score tokens via rugcheck (LP-locked, top holders, risks, holders)
  rugMinScore: 45,        // lower threshold to catch early — Solandier would've been caught here
  minHolders: 5,          // token MUST have at least this many holders (fresh coins start low)
  minLiqPct: 2,           // liquidity MUST be ≥ this % of mcap (liq that "matches" the token)
  bullishOnly: false,     // don't filter bearish — some 2x+ calls come from dip-buying
  // HARD REQUIREMENTS — every token must pass these
  requireLocked: false,      // FLOW MODE (owner): LP-lock no longer HARD-required — rugFilter/rugMinScore stays as the safety net. Was rejecting nearly every token.
  minVolM5: 10000,           // 5-min volume ≥ $10K — corpus: "$10K/5-min" momentum gate (0 = disabled)
  maxSnipersPct: 5,          // insider supply < 5% — per corpus: any snipers = 0% win rate
  maxBundlerPct: 3,          // bundle cluster supply < 3% — per corpus: any bundlers = 0% win rate
  minTop10Pct: 0,            // no floor — high top10 is a RISK signal per ZEROX corpus, not a bonus
  top10BullishBonus: 0,      // removed: corpus shows high top-10 = dump risk, not whale conviction
  // social requirements (off by default for sniper_seed, on for higher presets)
  requireWebsite: false,
  requireTwitter: false,
  requireSocial: false,
  minSocialScore: 0,
};
let _config = Object.assign({}, _defaults, _read(CFG_FILE, {}));
// FLOW MODE (2026-07-18): the hard-enforced LP-locked + sniper/concentration gates were
// rejecting nearly every current token (zero calls). Owner opted to loosen for more flow.
// Saved config now drives these gates; rugFilter (rugMinScore) stays on as the safety net so
// clear honeypots/danger tokens are still filtered. Re-tighten by restoring the overrides below.
if (_config.requireLocked == null) _config.requireLocked = _defaults.requireLocked;
if (!_config.maxSnipersPct) _config.maxSnipersPct = _defaults.maxSnipersPct;
function getConfig() { return Object.assign({}, _config); }
function setConfig(patch) { _config = Object.assign({}, _config, patch || {}); _write(CFG_FILE, _config); return getConfig(); }

// ── PRESETS: one-click filter bundles (tuned to actual win data) ────────────
// Social scoring: website=+2, twitter=+2, telegram=+1, discord=+1, locked=+2, ANY=+1
// Holder scoring: top10<18%=+3, no insiders=+2, no snipers=+2
// NOTE: maxSnipersPct, maxBundlerPct, minTop10Pct, maxTop10Pct, top10BullishBonus are intentionally
// ABSENT from all presets — they are global quality gates owned by tg-config.json and must never
// be silently overridden by a preset switch. Presets only control: FDV range, liquidity, volume,
// holder count, rug score, social requirements, and which feeds are active.
const PRESETS = {
  sniper_seed: {
    label: '🏆 Sniper Seed',
    desc: 'Ultra-low FDV, locked LP, whale conviction — the Solandier formula',
    maxFdv: 100000, minLiq: 2000, minVol24h: 1000, minHolders: 5,
    minLiqPct: 2, rugMinScore: 45, bullishOnly: false, bonded: false,
    newpools: true, trending: false, maxPer: 5,
    requireWebsite: false, requireTwitter: false, requireSocial: false,
    requireLocked: true, minSocialScore: 0,
  },
  anti_sniper: {
    label: '🎯 Anti-Sniper',
    desc: 'Locked LP + snipers/bundlers <10% + whale conviction',
    maxFdv: 200000, minLiq: 2000, minVol24h: 1000, minHolders: 10,
    minLiqPct: 2, rugMinScore: 50, bullishOnly: false, bonded: false,
    newpools: true, trending: false, maxPer: 5,
    requireWebsite: false, requireTwitter: false, requireSocial: false,
    requireLocked: true, minSocialScore: 0,
  },
  social_micro: {
    label: '💎 Social Micro',
    desc: 'Locked LP + website & X + whale top10 = real team with conviction',
    maxFdv: 300000, minLiq: 3000, minVol24h: 2000, minHolders: 10,
    minLiqPct: 2, rugMinScore: 50, bullishOnly: false, bonded: false,
    newpools: true, trending: false, maxPer: 5,
    requireWebsite: true, requireTwitter: true, requireSocial: false,
    requireLocked: true, minSocialScore: 3,
  },
  full_stack: {
    label: '🔥 Full Stack',
    desc: 'Locked + social stack + whale conviction = premium quality',
    maxFdv: 500000, minLiq: 5000, minVol24h: 3000, minHolders: 15,
    minLiqPct: 3, rugMinScore: 55, bullishOnly: false, bonded: false,
    newpools: true, trending: false, maxPer: 4,
    requireWebsite: true, requireTwitter: true, requireSocial: true,
    requireLocked: true, minSocialScore: 5,
  },
  momentum: {
    label: '⚡ Momentum',
    desc: 'Locked runners with social proof & whale accumulation',
    maxFdv: 2000000, minLiq: 15000, minVol24h: 30000, minHolders: 40,
    minLiqPct: 5, rugMinScore: 65, bullishOnly: true, bonded: false,
    newpools: true, trending: false, maxPer: 3,
    requireWebsite: true, requireTwitter: true, requireSocial: false,
    requireLocked: true, minSocialScore: 4,
  },
  safe_swing: {
    label: '🛡 Safe Swing',
    desc: 'Locked + full social + whale conviction = institutional quality',
    maxFdv: 50000000, minLiq: 40000, minVol24h: 25000, minHolders: 80,
    minLiqPct: 8, rugMinScore: 75, bullishOnly: true, bonded: false,
    newpools: false, trending: false, maxPer: 2,
    requireWebsite: true, requireTwitter: true, requireSocial: true,
    requireLocked: true, minSocialScore: 6,
  },
};
function listPresets() { return Object.keys(PRESETS).map(k => ({ key: k, label: PRESETS[k].label, desc: PRESETS[k].desc })); }
function applyPreset(name) {
  const p = PRESETS[name]; if (!p) return null;
  const patch = Object.assign({}, p); delete patch.label; delete patch.desc;
  patch.rugFilter = true;
  setConfig(patch);
  return getConfig();
}
function getPreset(name) { return PRESETS[name] || null; }
function activePresetKey() {
  const cfg = getConfig();
  for (const [k, v] of Object.entries(PRESETS)) {
    if (cfg.maxFdv === v.maxFdv && cfg.minLiq === v.minLiq && cfg.minVol24h === v.minVol24h) return k;
  }
  return null;
}

// ── send / broadcast ────────────────────────────────────────────────────────
async function send(chatId, html, extra) {
  const t = token(); if (!t || chatId == null) return false;
  try {
    const r = await fetch(TG(t, 'sendMessage'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {})),
    });
    if (!r.ok) {
      // 403 = bot blocked/kicked → prune the chat so we stop trying it
      if (r.status === 403) removeChat(chatId);
      return false;
    }
    return true;
  } catch (e) { return false; }
}

// Send a photo (local file path → uploaded bytes, or a public URL) with an HTML caption.
async function sendPhoto(chatId, photo, caption, buttons) {
  const t = token(); if (!t || chatId == null || !photo) return false;
  try {
    if (!/^https?:/i.test(photo) && fs.existsSync(photo)) {
      const fd = new FormData();
      fd.append('chat_id', String(chatId));
      if (caption) { fd.append('caption', caption.slice(0, 1024)); fd.append('parse_mode', 'HTML'); }
      if (buttons) fd.append('reply_markup', JSON.stringify(buttons));
      fd.append('photo', new Blob([fs.readFileSync(photo)]), 'img.png');
      const r = await fetch(TG(t, 'sendPhoto'), { method: 'POST', body: fd });
      if (r.status === 403) removeChat(chatId);
      return r.ok;
    }
    const body = { chat_id: chatId, photo, caption: (caption || '').slice(0, 1024), parse_mode: 'HTML' };
    if (buttons) body.reply_markup = buttons;
    const r = await fetch(TG(t, 'sendPhoto'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 403) removeChat(chatId);
    return r.ok;
  } catch (e) { return false; }
}

// Send an audio track (Buffer of WAV/MP3 bytes) with an HTML caption. Used by /music.
async function sendAudio(chatId, audio, filename, caption, title) {
  const t = token(); if (!t || chatId == null || !audio) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    if (caption) { fd.append('caption', caption.slice(0, 1024)); fd.append('parse_mode', 'HTML'); }
    if (title) fd.append('title', String(title).slice(0, 64));
    const mime = /\.mp3$/i.test(filename || '') ? 'audio/mpeg' : 'audio/wav';
    fd.append('audio', new Blob([audio], { type: mime }), filename || 'track.wav');
    const r = await fetch(TG(t, 'sendAudio'), { method: 'POST', body: fd });
    if (r.status === 403) removeChat(chatId);
    return r.ok;
  } catch (e) { return false; }
}
async function broadcastPhoto(photo, caption, buttons) {
  const t = token(); if (!t) return 0;
  const targets = new Set(); const ch = channel(); if (ch) targets.add(ch);
  chats().forEach(c => targets.add(c.id));
  let ok = 0; for (const id of targets) { if (await sendPhoto(id, photo, caption, buttons)) ok++; }
  return ok;
}

// Broadcast to the main channel + every registered chat. Returns count delivered.
// opts.buttons = a reply_markup inline_keyboard (from buildButtons) attached to each message.
async function broadcast(html, opts) {
  const t = token(); if (!t) return 0;
  const targets = new Set();
  const ch = channel(); if (ch && !(opts && opts.skipChannel)) targets.add(ch);
  chats().forEach(c => targets.add(c.id));
  const extra = (opts && opts.buttons) ? { reply_markup: opts.buttons } : undefined;
  let ok = 0;
  for (const id of targets) { if (await send(id, html, extra)) ok++; }
  return ok;
}

// Inline-keyboard buttons for a call card: Chart · DexScreener · pump.fun (+ optional 📸 PNL tap-button).
function buildButtons(mint, chain, chartUrl, opts) {
  if (!mint) return undefined;
  const c = (chain || 'solana').toLowerCase();
  const dsChain = c === 'sol' ? 'solana' : c;
  const rows = [];
  const r1 = [{ text: '📊 Chart', url: chartUrl || ('https://dexscreener.com/' + dsChain + '/' + mint) },
              { text: '🔎 DexScreener', url: 'https://dexscreener.com/' + dsChain + '/' + mint }];
  rows.push(r1);
  const r2 = [];
  if (dsChain === 'solana') r2.push({ text: '💊 pump.fun', url: 'https://pump.fun/' + mint });
  if (opts && opts.pnl) r2.push({ text: '📸 PNL Card', callback_data: ('pnl:' + mint).slice(0, 64) });
  if (r2.length) rows.push(r2);
  return { inline_keyboard: rows };
}

module.exports = { token, channel, addChat, removeChat, chats, getConfig, setConfig, send, broadcast, sendPhoto, sendAudio, broadcastPhoto, buildButtons, wasAlerted, markAlerted, resetAlerted, acquireBroadcastLock, listPresets, applyPreset, getPreset, activePresetKey };
