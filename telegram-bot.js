/* ══════════════════════════════════════════════════════════════════════════
   telegram-bot.js — the interactive SHADDAI Telegram bot (long-polling).
   Commands: /start /help /price /rug /ask /lb /pnl /stats /dist /signals /gm
   Reuses the FREE DexScreener + rugcheck.xyz APIs and the app's own
   LLM (/api/model/chat) for /ask.

   SECURITY: token from env only (TELEGRAM_BOT_TOKEN). No secrets in code.
   Fail-safe: no-op if the token is unset; never throws; never blocks boot.
   Long-polling (getUpdates) so it works with zero webhook/URL config.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const TG = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
const DS_SEARCH = (q) => `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
const RUGCHECK = (mint) => `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`;
const _core = require('./telegram-core');
const _pnl = require('./telegram-pnl');
const _wallets = require('./telegram-wallets');

const _cfg = () => ({
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  channel: process.env.TELEGRAM_CHANNEL || '',
  port: process.env.PORT || 3000,
});

const _esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function _fmtUsd(n) { const v = Number(n) || 0; if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'; return '$' + v.toFixed(2); }
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _send(token, chatId, html, extra) {
  try {
    await fetch(TG(token, 'sendMessage'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {})),
    });
  } catch (e) { /* fail-safe */ }
}

// ── interactive /signals menu ──────────────────────────────────────────────
// Returns the "Signals Hub" card — live channel + one-tap slices of the feed.
function _signalsCard(cfg) {
  let statsLine = '';
  try {
    const s = _pnl.stats('all') || _pnl.stats('day') || '';
    statsLine = s ? '\n' + s : '';
  } catch (e) { /* stats optional */ }
  return (
    '📡 <b>SHADDAI Signals Hub</b>\n' +
    '━━━━━━━━━━━━━━━\n\n' +
    'Live <b>rug-filtered</b> DEX signals with real <b>PNL tracking</b> (Xs, hit-rate, milestone wins).\n\n' +
    (cfg.channel ? `📢 Free signals channel: <b>${_esc(cfg.channel)}</b>\n\n` : '') +
    'Tap a button below for the slice you want 👇\n' +
    '<i>Live · not financial advice · always DYOR</i>'
  );
}
function _signalsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔥 Active calls now', callback_data: 'sig:active' },
       { text: '🏆 Leaderboard',        callback_data: 'sig:lb' }],
      [{ text: '📄 Last 25 calls',      callback_data: 'sig:last25' },
       { text: '📊 Stats / hit-rate',   callback_data: 'sig:stats' }],
      [{ text: '💠 Distribution',       callback_data: 'sig:dist' }],
    ],
  };
}


// ── help text ──────────────────────────────────────────────────────────────
function _help() {
  return (
    '⬡ <b>SHADDAI BOT</b> — commands:\n\n' +
    '/price <code>&lt;symbol|address&gt;</code> — live DEX price, liquidity & volume\n' +
    '/rug <code>&lt;mint&gt;</code> — rug-check a Solana token\n' +
    '/ask <code>&lt;question&gt;</code> — ask a SHADDAI agent anything\n' +
    '/zerox <code>&lt;asset&gt;</code> — ZEROX market analysis + sentiment\n' +
    '/news — live market pulse\n' +
    '/lb — leaderboard (top calls ranked by Xs)\n' +
    '/last25 /last50 /last75 /last100 — last N calls with live PNLs\n' +
    '/pnl <code>&lt;ticker&gt;</code> — PNL card for a specific token\n' +
    '/held — conviction holds: calls still green, ranked by ATH hold\n' +
    '/stats <code>[week|month]</code> — hit-rate + best calls scorecard\n' +
    '/dist — performance distribution (1-2x / 2-5x / 5-10x / 10x+)\n' +
    '/preset — view/switch filter presets (locked liq + whale conviction)\n' +
    '/wallets — list tracked wallets (smart money / alpha wallets)\n' +
    '/watch <code>&lt;address&gt; [label] [type]</code> — track a wallet (ape alerts)\n' +
    '/unwatch <code>&lt;address&gt;</code> — stop tracking a wallet\n' +
    '/wallet <code>&lt;address&gt;</code> — wallet profile + links\n' +
    '/signals — interactive signals hub (tap buttons for live slices)\n' +
    '/agents — what SHADDAI is\n' +
    '/gm — gm ☀️\n\n' +
    '<i>Not financial advice. Always DYOR.</i>'
  );
}
function _start(cfg) {
  const web = process.env.SHADDAI_WEBSITE || 'https://shaddai-g81x.onrender.com';
  const gh = process.env.SHADDAI_GITHUB || 'https://github.com/IzzoSol';
  const x = process.env.SHADDAI_X || 'https://x.com/IzzoSol';
  const lounge = process.env.SHADDAI_LOUNGE || 'https://t.me/EMERALDLOUNGE';
  return (
    '⬡ <b>Welcome to SHADDAI</b> — Sovereign AI Agents\n' +
    '━━━━━━━━━━━━━━━\n' +
    'Forge AI agents that <b>live, work &amp; earn</b> — intelligence you <b>own</b>, on open rails (Solana · x402).\n\n' +
    'Live <b>rug-filtered crypto signals</b> with real <b>PNL tracking</b> (Xs, hit-rate, milestone wins).\n\n' +
    '🤖 The council: SHADDAI · ZEROX · ORACLE · NEXUS · TURTLE · QUILL · PIKADON\n\n' +
    `📡 Free signals: ${_esc(cfg.channel || '@ShaddaiLabs')}\n` +
    `🌿 Lounge: ${_esc(lounge)}\n` +
    `⭐ GitHub: ${_esc(gh)}\n` +
    `𝕏 ${_esc(x)}\n` +
    `🌐 ${_esc(web)}\n\n` +
    '<b>Try:</b> /lb · /pnl SOLANDIER · /price SOL · /rug &lt;mint&gt;\n' +
    'Type /help for the full command list.'
  );
}

// ── price lookup ───────────────────────────────────────────────────────────
async function _price(token, chatId, q) {
  if (!q) return _send(token, chatId, 'Usage: /price <symbol or address>  e.g. <code>/price SOL</code>');
  await _send(token, chatId, '🔎 <b>' + _esc(q) + '</b>…');
  try {
    const r = await fetch(DS_SEARCH(q));
    const j = await r.json();
    const pairs = (j && j.pairs) || [];
    const p = pairs.filter(x => x.liquidity && x.liquidity.usd).sort((a, b) => (b.liquidity.usd || 0) - (a.liquidity.usd || 0))[0];
    if (!p) return _send(token, chatId, '❌ No pairs found for <b>' + _esc(q) + '</b>.');
    const b = p.baseToken || {};
    const ch = p.priceChange && p.priceChange.h24 != null ? (Number(p.priceChange.h24) >= 0 ? '🟢 +' : '🔴 ') + Number(p.priceChange.h24).toFixed(1) + '%' : '';
    return _send(token, chatId,
      `<b>${_esc(b.name || b.symbol || q)}</b> ($${_esc(b.symbol || '')}) · ${_esc((p.chainId || '').toUpperCase())}  ${ch}\n` +
      `💵 <b>$${_esc(Number(p.priceUsd || 0).toPrecision(4))}</b>\n` +
      `💧 Liq: <b>${_fmtUsd(p.liquidity && p.liquidity.usd)}</b>  📊 24h Vol: <b>${_fmtUsd(p.volume && p.volume.h24)}</b>\n` +
      (p.url ? `🔗 <a href="${_esc(p.url)}">DexScreener</a>` : ''));
  } catch (e) { return _send(token, chatId, '⚠️ Lookup failed — try again.'); }
}

// ── rug check ──────────────────────────────────────────────────────────────
async function _rug(token, chatId, mint) {
  if (!mint) return _send(token, chatId, 'Usage: /rug <token mint address>');
  await _send(token, chatId, '🛡 Rug-checking…');
  try {
    const r = await fetch(RUGCHECK(mint.trim()));
    if (!r.ok) return _send(token, chatId, '⚠️ No report for that mint. DYOR.');
    const j = await r.json();
    const score = (j && (j.score_normalised != null ? j.score_normalised : j.score));
    const risks = (j && j.risks) || [];
    const rl = risks.slice(0, 5).map(x => `• ${_esc(x.name || x.description || '')}${x.level ? ' (' + _esc(x.level) + ')' : ''}`).join('\n');
    return _send(token, chatId,
      `🛡 <b>Rug Check</b>\n` +
      (score != null ? `Risk score: <b>${_esc(String(score))}</b>\n` : '') +
      (rl ? `\n<b>Flags:</b>\n${rl}\n` : '\nNo major flags.\n') +
      `\n<i>Always DYOR.</i>`);
  } catch (e) { return _send(token, chatId, '⚠️ Rug check failed — try again.'); }
}

// ── ask agent ──────────────────────────────────────────────────────────────
async function _ask(token, chatId, cfg, q, agent) {
  if (!q) return _send(token, chatId, 'Usage: /ask <your question>');
  await _send(token, chatId, '🧠 Thinking…');
  try {
    const r = await fetch(`http://127.0.0.1:${cfg.port}/api/model/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, agent: agent || 'SHADDAI' }), signal: AbortSignal.timeout(45000),
    });
    const j = await r.json();
    const out = (j && (j.content || j.reply || j.result)) || '';
    return _send(token, chatId, out ? _esc(out).slice(0, 3800) : '⚠️ No answer — engine may be busy.');
  } catch (e) { return _send(token, chatId, '⚠️ Agents busy — try again shortly.'); }
}

// ── command router ─────────────────────────────────────────────────────────
// inline-button taps — 📸 PNL Card button + the interactive /signals menu
async function _isAdmin(t,cid,uid){try{const r=await fetch(TG(t,"getChatAdministrators")+"?chat_id="+cid);const j=await r.json();if(!j.ok||!Array.isArray(j.result))return false;return j.result.some(function(a){return a.user&&String(a.user.id)===String(uid);});}catch(e){return false;}}\n\nasync function _handleCallback(cfg, cq) {
  const t = cfg.token;
  const answer = (text) => fetch(TG(t, 'answerCallbackQuery'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: cq.id, text: text || '' }) }).catch(() => {});
  try {
    const data = String(cq.data || '');
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    // interactive /signals menu — tap a button to pull the live feed slice you want
    if (data.startsWith('sig:') && chatId) {
      const key = data.slice(4);
      await answer('Loading…');
      let html = null, kb = null;
      if (key === 'active')      html = _pnl.activeCalls ? _pnl.activeCalls() : _pnl.lastCalls(25);
      else if (key === 'lb')     html = _pnl.pnlCaption('week');
      else if (key === 'last25') html = _pnl.lastCalls(25);
      else if (key === 'stats')  html = _pnl.stats('day');
      else if (key === 'dist')   html = _pnl.distribution();
      else if (key === 'menu')   { html = _signalsCard(cfg); kb = _signalsKeyboard(); }
      else return answer('Unknown option');
      if (!html) return answer('No data yet — signals are warming up.');
      const extra = kb ? { reply_markup: kb } : undefined;
      return _send(t, chatId, html, extra);
    }
    if (data.startsWith('pnl:') && chatId) {
      const key = data.slice(4);
      const cap = _pnl.pnlForToken(key) || 'No tracked call found for that token.';
      const call = _pnl._findCall ? _pnl._findCall(key) : null;
      const btns = _core.buildButtons(key, (call && call.chain) || 'solana', null);
      await answer('📸 Generating PNL card…');
      // AI-generated PNL image first (HF keys + Pollinations fallback)
      let img = null;
      try { if (_pnl.pnlImages) img = await _pnl.pnlImages.generatePnlImage(call || { symbol: key, peakMult: 1, curMult: 1 }); } catch (e) {}
      // Fall back to milestone image, then random static pnl image
      if (!img) img = call ? (_pnl.milestoneImage(call.curMult || call.peakMult) || _pnl.pnlImage()) : _pnl.pnlImage();
      if (img) { const ok = await _core.sendPhoto(chatId, img, cap, btns); if (ok) return; }
      return _send(t, chatId, cap);
    }
    return answer();
  } catch (e) { return answer(); }
}

// /music — compose a free procedural track (Turtle Music Bot) and send it as audio.
// Args (any order, all optional): genre (lofi/synthwave/trap/ambient/house/8bit),
// mood (chill/bright/dark/dreamy/hype), and a bar count 4-16.
async function _music(t, chatId, arg) {
  const mg = require('./lib/music-gen-node');
  let genre = null, mood = null, bars = 8;
  String(arg || '').toLowerCase().split(/\s+/).filter(Boolean).forEach((w) => {
    const gk = mg.pickGenre(w), mk = mg.pickMood(w);
    if (!genre && gk) genre = gk;
    else if (!mood && mk) mood = mk;
    else if (/^\d+$/.test(w)) bars = Math.max(4, Math.min(16, parseInt(w, 10)));
  });
  await _send(t, chatId, '🐢 <b>Turtle Music Bot</b> is composing a <b>' + (genre || 'lofi') + '</b> track…');
  try {
    const { wav, meta } = mg.generate({ genre, mood, bars });
    const cap = '🐢 <b>Turtle Music Bot</b> · ' + meta.genreName + ' · ' + meta.bpm + ' BPM · ' + meta.seconds + 's\n' +
      '<i>Free procedural track · ShaddaiLabs</i>\nTry: <code>/music synthwave hype</code>';
    const ok = await _core.sendAudio(chatId, wav, 'turtle-' + meta.genre + '.wav', cap, meta.genreName + ' — Turtle Music Bot');
    if (!ok) return _send(t, chatId, '⚠️ Could not send the track. Try again in a moment.');
  } catch (e) {
    return _send(t, chatId, '⚠️ Music engine hiccup — try <code>/music lofi</code>');
  }
}

async function _handle(cfg, update) {
  if (update.callback_query) return _handleCallback(cfg, update.callback_query);
  const msg = update.message || update.channel_post; if (!msg) return;
  try { if (msg && msg.chat) { try { _core.addChat(msg.chat); } catch (e) {} } } catch (e) {}
  const chatId = msg.chat && msg.chat.id; const text = (msg.text || '').trim();
  if (!chatId || !text) return;
  const m = text.match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return;
  const cmd = m[1].toLowerCase(); const arg = (m[2] || '').trim(); const t = cfg.token;
  switch (cmd) {
    case 'start': { if (msg && msg.chat) { try { _core.addChat(msg.chat); } catch (e) {} } const img = require('./telegram-news')._botImage(); const cap = _start(cfg); if (img) { const ok = await _core.sendPhoto(chatId, img, cap); if (ok) return; } return _send(t, chatId, cap); }\n    case 'help': return _send(t, chatId, _help());
    case 'price': case 'p': return _price(t, chatId, arg);
    case 'rug': case 'rugcheck': return _rug(t, chatId, arg);
    case 'ask': case 'shaddai': return _ask(t, chatId, cfg, arg);
    case 'zerox': case 'analysis': return _ask(t, chatId, cfg, 'Give a concise crypto market analysis + sentiment right now for: ' + (arg || 'the overall market') + '. 5 lines max.', 'ZEROX');
    case 'news': case 'pulse': { const html = await require('./telegram-news').marketPulse(); return _send(t, chatId, html || '⚠️ Market data unavailable.'); }

    // /music [genre] [mood] [bars] — free procedural track by Turtle Music Bot (ShaddaiLabs)
    case 'music': case 'song': case 'beat': case 'track': return _music(t, chatId, arg);
    case 'pnlhour': case 'pnl_hour': { const c=_pnl.listCalls(); const m=require('./telegram-pnl'); const b=(m&&m._byPeriod)?m._byPeriod(c,'hour'):{}; let html='?P PnL by Hour\n'; Object.keys(b).slice(-12).forEach(k=>{const x=b[k];html+='<code>'+k+'</code>: '+x.calls+'c '+x.hits2x+'x2 '+x.hitRate+'% avg '+x.avgGain+'%\n';});return _send(t,chatId,html||'No data'); }
    case 'pnlday': case 'pnl_day': { const c=_pnl.listCalls(); const m=require('./telegram-pnl'); const b=(m&&m._byPeriod)?m._byPeriod(c,'day'):{}; let html='?P PnL by Day\n'; Object.keys(b).slice(-14).forEach(k=>{const x=b[k];html+='<code>'+k+'</code>: '+x.calls+'c '+x.hits2x+'x2 '+x.hitRate+'% avg '+x.avgGain+'%\n';});return _send(t,chatId,html||'No data'); }
    case 'pnlmonth': case 'pnl_month': { const c=_pnl.listCalls(); const m=require('./telegram-pnl'); const b=(m&&m._byPeriod)?m._byPeriod(c,'month'):{}; let html='?P PnL by Month\n'; Object.keys(b).slice(-12).forEach(k=>{const x=b[k];html+='<code>'+k+'</code>: '+x.calls+'c '+x.hits2x+'x2 '+x.hitRate+'% avg '+x.avgGain+'%\n';});return _send(t,chatId,html||'No data'); }
    case 'pnl': case 'performance': { const c=_pnl.listCalls(); const m=require('./telegram-pnl'); let html='?P PnL\nHour/Day/Month: /pnlhour /pnlday /pnlmonth\n\n7d by day:\n'; const b=(m&&m._byPeriod)?m._byPeriod(c,'day'):{}; Object.keys(b).slice(-7).forEach(k=>{const x=b[k];html+='<code>'+k+'</code>: '+x.calls+'c '+x.hits2x+'x2 '+x.hitRate+'%\n';});return _send(t,chatId,html); }
    case 'stats': case 'scorecard': { const per = /week/i.test(arg) ? 'week' : /month/i.test(arg) ? 'month' : 'day'; return _send(t, chatId, _pnl.stats(per)); }

    // /lb — leaderboard (text only, no image, no HF)
    case 'lb': return _send(t, chatId, _pnl.pnlCaption(arg || 'week'));

    // /last, /last25, /last50, /last75, /last100 — last N calls with live PNLs
    case 'last': case 'last25': case 'last50': case 'last75': case 'last100': {
      const n = cmd === 'last' ? (parseInt(arg, 10) || 25) : parseInt(cmd.slice(4), 10);
      return _send(t, chatId, _pnl.lastCalls(n));
    }

    // /active — live calls right now (not rugged, <72h), sorted by current gain
    case 'active': case 'live': case 'open': case 'now':
      return _send(t, chatId, _pnl.activeCalls ? _pnl.activeCalls() : _pnl.lastCalls(25));

    // /pnl <ticker> — PNL card for one token (milestone image if at that level, text always)
    case 'pnl': {
      if (!arg) return _send(t, chatId, 'Usage: /pnl <code>&lt;ticker&gt;</code>  e.g. <code>/pnl SOLANDIER</code>');
      const cap = _pnl.pnlForToken(arg);
      if (!cap) return _send(t, chatId, 'No tracked call found for <b>' + _esc(arg) + '</b>. Try /lb for the leaderboard.');
      // try milestone image first, then saved image, then random pnl image
      const call = _pnl._findCall ? _pnl._findCall(arg) : null;
      const msImg = call ? _pnl.milestoneImage(call.curMult || call.peakMult) : null;
      if (msImg) { const ok = await _core.sendPhoto(chatId, msImg, cap); if (ok) return; }
      const saved = _pnl.savedPnlImage(arg);
      if (saved) { const ok = await _core.sendPhoto(chatId, saved, cap); if (ok) return; }
      return _send(t, chatId, cap);
    }

    case 'dist': case 'distribution': case 'performance': return _send(t, chatId, _pnl.distribution());

    // /held — long-term "conviction holds": calls still green, ranked by how well they held their ATH
    case 'held': case 'holds': case 'survivors': case 'conviction': case 'longterm': {
      const per = /week|wk|7d/i.test(arg) ? 'week' : 'day';
      const cap = _pnl.survivors(per);
      const img = _pnl.pnlImage && _pnl.pnlImage();
      if (img) { const ok = await _core.sendPhoto(chatId, img, cap); if (ok) return; }
      return _send(t, chatId, cap);
    }

    // /preset — view all presets or switch active one
    case 'stop': {
      const isPriv = msg.chat && msg.chat.type === 'private';
      if (isPriv) return _send(t, chatId, 'Use /stop in the group to disable the bot there (admins only).');
      const isAdmin = await _isAdmin(t, chatId, msg.from && msg.from.id);
      if (!isAdmin) return _send(t, chatId, 'Only admins can stop the bot in this group.');
      _core.removeChat(chatId);
      return _send(t, chatId, 'Bot stopped in this group. Use /start to re-enable.');
    }
    case 'reset': {
      if (!arg) return _send(t, chatId, 'Usage: /reset <admin_code>  (e.g. /reset 4444)');
      if (String(arg).trim() !== '4444') return _send(t, chatId, 'Invalid admin code.');
      const isAdmin = await _isAdmin(t, chatId, msg.from && msg.from.id);
      if (!isAdmin && msg.chat && msg.chat.type !== 'private') return _send(t, chatId, 'Only admins can reset hit rate.');
      try { if (_pnl && _pnl.resetCalls) _pnl.resetCalls(); else require('./telegram-pnl').resetCalls(); } catch (e) {}
      return _send(t, chatId, 'Hit rate stats reset (cleared all tracked calls).');
    }
    case 'stop': {
      const isPriv = msg.chat && msg.chat.type === 'private';
      if (isPriv) return _send(t, chatId, 'Use /stop in the group to disable the bot there (admins only).');
      const isAdmin = await _isAdmin(t, chatId, msg.from && msg.from.id);
      if (!isAdmin) return _send(t, chatId, 'Only admins can stop the bot in this group.');
      _core.removeChat(chatId);
      return _send(t, chatId, 'Bot stopped in this group. Use /start to re-enable.');
    }
    case 'preset': {
      const presets = _core.listPresets();
      const active = _core.activePresetKey();
      if (!arg) {
        let html = '🎛 <b>Filter Presets</b>\n━━━━━━━━━━━━━\n\n';
        html += 'Current: <b>' + (active ? _core.getPreset(active).label : 'Custom') + '</b>\n\n';
        presets.forEach(p => {
          const isActive = p.key === active;
          html += (isActive ? '▸ ' : '  ') + '<b>' + p.label + '</b>\n';
          html += '  <code>/preset ' + p.key + '</code> — ' + p.desc + '\n\n';
        });
        html += '<i>Switch preset to change all filters at once.</i>';
        return _send(t, chatId, html);
      }
      const result = _core.applyPreset(arg);
      if (!result) return _send(t, chatId, '❌ Unknown preset: <code>' + _esc(arg) + '</code>. Try /preset to see all options.');
      const p = _core.getPreset(arg);
      return _send(t, chatId,
        '✅ <b>Switched to ' + (p ? p.label : arg) + '</b>\n\n' +
        '• Max FDV: <code>$' + (result.maxFdv / 1000).toFixed(0) + 'K</code>\n' +
        '• Min Liq: <code>$' + result.minLiq + '</code>\n' +
        '• Min Vol: <code>$' + result.minVol24h + '</code>\n' +
        '• Min Holders: <code>' + result.minHolders + '</code>\n' +
        '• Rug Score: <code>' + result.rugMinScore + '+</code>\n' +
        '• 🔒 Locked LP: <code>required</code>\n' +
        (result.maxSnipersPct ? '• 🔫 Snipers+Bundlers: <code>&lt;' + result.maxSnipersPct + '%</code>\n' : '') +
        (result.minTop10Pct ? '• 🐊 Whale Top10: <code>≥' + result.minTop10Pct + '%</code> (bullish)\n' : '') +
        (result.top10BullishBonus ? '• 🏋️ Whale Bonus: <code>+' + result.top10BullishBonus + '</code> confidence\n' : '') +
        (result.requireWebsite ? '• 🌐 Website required\n' : '') +
        (result.requireTwitter ? '• 𝕏 Twitter required\n' : '') +
        (result.requireSocial ? '• 📱 Social required (3+)\n' : '') +
        '\nFilters updated instantly.'
      );
    }

    // /watch <address> [label] [type] — add wallet to watchlist
    case 'watch': {
      if (!arg) return _send(t, chatId, 'Usage: <code>/watch &lt;address&gt; [label] [alpha|whale|smart|kol|dev]</code>\n\nExample: <code>/watch ABC...XYZ "Whale Wang" whale</code>');
      const parts = arg.match(/^(\S+)(?:\s+"([^"]+)"|\s+(\S+))?(?:\s+(alpha|whale|smart|kol|dev|fund|team))?$/i);
      const addr = parts ? parts[1] : arg.split(/\s+/)[0];
      const label = parts ? (parts[2] || parts[3] || null) : null;
      const type = (parts && parts[4]) || 'alpha';
      const w = _wallets.addWallet(addr, label, type);
      if (!w) return _send(t, chatId, '❌ Invalid address. Must be a valid Solana address (32-44 chars).');
      _wallets.restartWatcher();
      return _send(t, chatId,
        `✅ <b>Watching</b> ${_wallets._walletEmoji ? '' : ''}wallet\n\n` +
        `Label: <b>${_esc(w.label)}</b>\n` +
        `Type: <b>${_esc(w.type)}</b>\n` +
        `<code>${_esc(w.address)}</code>\n\n` +
        `I'll alert when this wallet apes into something and show when it's in a signal's top holders.`
      );
    }

    case 'unwatch': {
      if (!arg) return _send(t, chatId, 'Usage: <code>/unwatch &lt;address&gt;</code>');
      const removed = _wallets.removeWallet(arg.trim());
      _wallets.restartWatcher();
      return _send(t, chatId, removed ? `✅ Removed from watchlist.` : `❌ Address not found in watchlist.`);
    }

    case 'wallets': case 'watching': return _send(t, chatId, _wallets.walletsListCard());

    case 'wallet': {
      if (!arg) return _send(t, chatId, 'Usage: <code>/wallet &lt;address&gt;</code>\nOr use /wallets to see all watched.');
      return _send(t, chatId, _wallets.walletCard(arg.trim()));
    }

    case 'signals': case 'hub': case 'feed': return _send(t, chatId, _signalsCard(cfg), { reply_markup: _signalsKeyboard() });
    case 'agents': return _send(t, chatId, '⬡ <b>SHADDAI</b> is an AI agent empire — forge agents, chain workflows, walk a 3D/2D world, trade in the Bazaar.\n🌐 https://shaddai-g81x.onrender.com');
    case 'about': case 'project': case 'info': { const news = require('./telegram-news'); const img = news._botImage(); const cap = news.projectPromo(); if (img) { const ok = await _core.sendPhoto(chatId, img, cap); if (ok) return; } return _send(t, chatId, cap); }
    case 'axiom': case 'trade': {
      const cap = '⚡ <b>Unlock the Axiom Edge</b>\n\nOn Phantom? Axiom adds a pro trading layer — stop-losses, advanced orders, and wallet tracking to copy winners &amp; dodge dev wallets/KOLs.\n\n🔗 <a href="https://axiom.trade/@emeraldog">axiom.trade/@emeraldog</a>\n<i>(Rewards go to users who actively trade.)</i>\n\n🎁 Star our GitHub, follow @IzzoSol, and trade via the link → DM for <b>1 week Premium free</b>.';
      const img = require('./telegram-news')._botImage(); if (img) { const ok = await _core.sendPhoto(chatId, img, cap); if (ok) return; } return _send(t, chatId, cap);
    }
    case 'gm': return _send(t, chatId, 'gm ☀️ — go forge something.');
    default: return _send(t, chatId, 'Unknown command. Try /help');
  }
}

// ── Telegram long-polling loop ─────────────────────────────────────────────
async function _getUpdates(token, offset) {
  const r = await fetch(TG(token, 'getUpdates') + `?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(40000) });
  const j = await r.json();
  return (j && j.result) || [];
}

// Register commands so they show up in Telegram's "/" menu
// Must register for EACH scope — default only covers private chats
async function _registerCommands(token) {
  const commands = [
    { command: 'start',   description: 'Welcome + links' },
    { command: 'help',    description: 'All commands list' },
    { command: 'active',  description: 'Live calls right now — not rugged, sorted by gain' },
    { command: 'lb',      description: 'Leaderboard — top calls ranked by Xs' },
    { command: 'last25',  description: 'Last 25 calls with live PNLs' },
    { command: 'last50',  description: 'Last 50 calls with live PNLs' },
    { command: 'last100', description: 'Last 100 calls with live PNLs' },
    { command: 'pnl',     description: 'PNL card for a token  e.g. /pnl PORK' },
    { command: 'held',    description: 'Conviction holds — calls still green' },
    { command: 'stats',   description: 'Hit-rate + best calls scorecard' },
    { command: 'dist',    description: 'Performance distribution breakdown' },
    { command: 'price',   description: 'Live DEX price  e.g. /price BONK' },
    { command: 'rug',     description: 'Rug-check a Solana mint' },
    { command: 'preset',  description: 'View/switch signal filter presets' },
    { command: 'ask',     description: 'Ask a SHADDAI agent anything' },
    { command: 'music',   description: 'Free music track  e.g. /music synthwave hype' },
    { command: 'zerox',   description: 'ZEROX market analysis + sentiment' },
    { command: 'news',    description: 'Live market pulse' },
    { command: 'signals', description: 'Interactive signals hub — active calls, leaderboard, stats' },
    { command: 'agents',  description: 'What is SHADDAI' },
    { command: 'wallets', description: 'List tracked wallets (smart money)' },
    { command: 'watch',   description: 'Track a wallet — get ape alerts' },
    { command: 'unwatch', description: 'Stop tracking a wallet' },
    { command: 'wallet',  description: 'Wallet profile + links' },
    { command: 'axiom',   description: 'Axiom trading edge + referral' },
    { command: 'gm',      description: 'gm ☀️' },
  ];
  // Register for all scopes so "/" menu works in private chats, groups, and channels
  const scopes = [
    { type: 'default' },
    { type: 'all_private_chats' },
    { type: 'all_group_chats' },
    { type: 'all_chat_administrators' },
  ];
  for (const scope of scopes) {
    try {
      await fetch(TG(token, 'setMyCommands'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands, scope }),
      });
    } catch (e) { /* non-fatal */ }
  }
}

let _running = false;
async function _loop() {
  const cfg = _cfg();
  await _registerCommands(cfg.token);
  let offset = 0, fails = 0;
  while (_running) {
    try {
      const updates = await _getUpdates(cfg.token, offset);
      fails = 0;
      for (const u of updates) { offset = u.update_id + 1; _handle(_cfg(), u).catch(() => {}); }
    } catch (e) { fails++; await _sleep(Math.min(30000, 2000 * fails)); }
  }
}

function startTelegramBot() {
  const cfg = _cfg();
  if (!cfg.token) { console.log('[tg-bot] disabled — set TELEGRAM_BOT_TOKEN to enable.'); return; }
  if (_running) return;
  _running = true;
  console.log('[tg-bot] ENABLED — /lb /pnl /price /rug /preset /ask /stats /dist /signals /gm');
  _loop().catch(e => { console.warn('[tg-bot] loop ended:', e && e.message); _running = false; });
}
function stopTelegramBot() { _running = false; }

module.exports = { startTelegramBot, stopTelegramBot };

