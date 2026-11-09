/* ══════════════════════════════════════════════════════════════════════════
   telegram-news.js — scheduled MARKET PULSE broadcaster.
   Every N minutes (dashboard-configurable) posts a free market brief to the
   channel + every chat the bot is in: total mcap, BTC/ETH, dominance, trending.
   Uses the FREE CoinGecko API (no key). Fail-safe: skips if TG unconfigured.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const core = require('./telegram-core');
const fs = require('fs');
const path = require('path');

const CG = 'https://api.coingecko.com/api/v3';
const BOT_IMG_DIR = path.join(__dirname, '..', 'public', 'assets', 'bot');
// random branded HF image (img-1..10.png) for aesthetic posts (promo etc.); null if none
function _botImage() { try { const imgs = []; for (let i = 1; i <= 10; i++) { const f = path.join(BOT_IMG_DIR, 'img-' + i + '.png'); if (fs.existsSync(f)) imgs.push(f); } return imgs.length ? imgs[Math.floor(Math.random() * imgs.length)] : null; } catch (e) { return null; } }
const _esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function _usd(n) { const v = Number(n) || 0; if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T'; if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; return '$' + v.toLocaleString(); }
function _pct(n) { const v = Number(n); if (!isFinite(v)) return ''; return (v >= 0 ? '🟢 +' : '🔴 ') + v.toFixed(1) + '%'; }

async function marketPulse() {
  try {
    // Kraken ticker — US-cloud friendly (Binance geo-blocks US/Render IPs). price + 24h change.
    const prices = {};
    try {
      const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD');
      if (r.ok) {
        const res = (await r.json()).result || {};
        const kr = (...keys) => { for (const k of keys) if (res[k]) return res[k]; return null; };
        const mk = (t) => { if (!t) return null; const last = Number(t.c[0]), open = Number(t.o); return { p: last, c: open ? ((last - open) / open * 100) : 0 }; };
        prices.BTCUSDT = mk(kr('XXBTZUSD', 'XBTUSD'));
        prices.ETHUSDT = mk(kr('XETHZUSD', 'ETHUSD'));
        prices.SOLUSDT = mk(kr('SOLUSD'));
        Object.keys(prices).forEach(k => { if (!prices[k]) delete prices[k]; });
      }
    } catch (e) {}
    // Global mcap + dominance — CoinLore (no key, US-cloud/Render friendly; CoinGecko IP-blocks Render).
    let mcap, mcapChg, btcDom, ethDom, vol24;
    try {
      const g = (await (await fetch('https://api.coinlore.net/api/global/')).json())[0];
      if (g) { mcap = Number(g.total_mcap) || 0; mcapChg = Number(g.mcap_change); btcDom = Number(g.btc_d); ethDom = Number(g.eth_d); vol24 = Number(g.total_volume) || 0; }
    } catch (e) {}
    // fallback: CoinGecko global (works locally / non-Render)
    if (!mcap) { try { const g = (await (await fetch(`${CG}/global`)).json()).data; mcap = g.total_market_cap && g.total_market_cap.usd; mcapChg = g.market_cap_change_percentage_24h_usd; btcDom = g.market_cap_percentage && g.market_cap_percentage.btc; } catch (e) {} }
    const line = (s, label) => prices[s] ? `${label}: <b>$${prices[s].p.toLocaleString(undefined, { maximumFractionDigits: prices[s].p < 10 ? 2 : 0 })}</b>  ${_pct(prices[s].c)}` : '';
    const coins = [line('BTCUSDT', '₿ BTC'), line('ETHUSDT', 'Ξ ETH'), line('SOLUSDT', '◎ SOL')].filter(Boolean);
    if (!coins.length && !mcap) return null;   // nothing to show — don't post an empty card
    return (
      `📊 <b>SHADDAI MARKET PULSE</b>\n` +
      `━━━━━━━━━━━━━\n` +
      (mcap ? `🌐 Total mcap: <b>${_usd(mcap)}</b>  ${_pct(mcapChg)}\n` : '') +
      (vol24 ? `📈 24h vol: <b>${_usd(vol24)}</b>\n` : '') +
      (btcDom ? `👑 BTC dom: <b>${btcDom.toFixed(1)}%</b>${ethDom ? `   Ξ ETH dom: <b>${ethDom.toFixed(1)}%</b>` : ''}\n` : '') +
      (mcap || btcDom ? '\n' : '') +
      coins.join('\n') +
      `\n\n<i>NFA · DYOR</i>`
    );
  } catch (e) { return null; }
}

// ── FREE RSS NEWS HEADLINES (no key) ────────────────────────────────────────
const RSS_FEEDS = (process.env.TG_NEWS_RSS ||
  'https://cointelegraph.com/rss,https://www.coindesk.com/arc/outboundfeeds/rss/,https://decrypt.co/feed'
).split(',').map(s => s.trim()).filter(Boolean);
const _seenNews = new Set();
let _newsSeeded = false;
function _rssItems(xml) {
  const out = [];
  const re = /<item[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < 12) {
    const blk = m[0];
    const t = (blk.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1];
    const l = (blk.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || [])[1];
    if (t && l) out.push({ title: t.trim(), link: l.trim() });
  }
  return out;
}
async function _pollHeadlines() {
  if (!core.token() || core.getConfig().headlines === false) return;
  let posted = 0;
  for (const feed of RSS_FEEDS) {
    if (posted >= 2) break;
    let xml;
    try { const r = await fetch(feed, { headers: { 'user-agent': 'Mozilla/5.0 (SHADDAI)' } }); if (!r.ok) continue; xml = await r.text(); } catch (e) { continue; }
    const items = _rssItems(xml).slice(0, 4);
    for (const it of items) {
      if (posted >= 2) break;
      if (_seenNews.has(it.link)) continue;
      _seenNews.add(it.link);
      if (_newsSeeded) {
        const html = '📰 <b>' + _esc(it.title) + '</b>\n<a href="' + _esc(it.link) + '">Read →</a>';
        if (await core.broadcast(html)) posted++;
      }
      if (_seenNews.size > 3000) { const f = _seenNews.values().next().value; _seenNews.delete(f); }
    }
  }
  _newsSeeded = true;   // first poll only seeds — then post only NEW headlines
}

// ── TOP 25 DEXSCREENER BOOSTED (every 4h) ───────────────────────────────────
const DS_BOOSTS = 'https://api.dexscreener.com/token-boosts/latest/v1';
const _fmtUsdN = (n) => { const v = Number(n) || 0; if (v >= 1e9) return '$' + (v/1e9).toFixed(2)+'B'; if (v >= 1e6) return '$' + (v/1e6).toFixed(2)+'M'; if (v >= 1e3) return '$' + (v/1e3).toFixed(1)+'K'; return '$'+v.toFixed(0); };

async function dexTop25() {
  try {
    const r = await fetch(DS_BOOSTS);
    if (!r.ok) return null;
    const items = await r.json();
    if (!Array.isArray(items)) return null;
    const sol = items.filter(i => String(i.chainId || '').toLowerCase() === 'solana').slice(0, 25);
    if (!sol.length) return null;

    // Enrich all 25 tokens with pair data — symbol, name, mcap, liq, 24h change
    const enriched = new Map();
    await Promise.all(sol.map(async (t) => {
      try {
        const r2 = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + t.tokenAddress, { signal: AbortSignal.timeout(5000) });
        if (!r2.ok) return;
        const j2 = await r2.json();
        const pairs = (j2 && j2.pairs) || [];
        const best = pairs.sort((a, b) => (b.liquidity && b.liquidity.usd || 0) - (a.liquidity && a.liquidity.usd || 0))[0];
        if (best) enriched.set(t.tokenAddress, {
          symbol:   best.baseToken && best.baseToken.symbol || '',
          name:     best.baseToken && best.baseToken.name   || '',
          fdv:      Number(best.fdv || best.marketCap) || 0,
          liq:      Number(best.liquidity && best.liquidity.usd) || 0,
          vol24:    Number(best.volume && best.volume.h24) || 0,
          change24: best.priceChange && best.priceChange.h24 != null ? Number(best.priceChange.h24) : null,
          url:      best.url || '',
        });
      } catch (e) {}
    }));

    // Build one card per token — send as separate messages for top 5, list for 6-25
    const cards = sol.map((t, i) => {
      const info = enriched.get(t.tokenAddress) || {};
      const sym    = info.symbol ? `$${_esc(info.symbol)}` : '?';
      const name   = info.name && info.name !== info.symbol ? ` — ${_esc(info.name)}` : '';
      const ca     = t.tokenAddress || '';
      const dsUrl  = info.url || t.url || `https://dexscreener.com/solana/${ca}`;
      const mcStr  = info.fdv  > 0 ? `MC ${_fmtUsdN(info.fdv)}`   : '';
      const liqStr = info.liq  > 0 ? `Liq ${_fmtUsdN(info.liq)}`  : '';
      const volStr = info.vol24> 0 ? `Vol ${_fmtUsdN(info.vol24)}` : '';
      const chg    = info.change24 != null
        ? (info.change24 >= 0 ? `🟢 +${info.change24.toFixed(1)}%` : `🔴 ${info.change24.toFixed(1)}%`)
        : '';
      const icon   = t.icon || '';   // token's own DexScreener icon
      const stats  = [mcStr, liqStr, volStr].filter(Boolean).join(' · ');
      return { rank: i + 1, sym, name, ca, dsUrl, stats, chg, icon, totalBoost: Number(t.totalAmount || t.amount || 0) };
    });

    const ts = new Date().toUTCString().replace(/.*(\d{2}:\d{2}).*/, '$1');

    // Return structured object so caller can use images
    return { cards, ts };
  } catch (e) { return null; }
}

// ── TOP MOVERS LEADERBOARD (1d / 1w / 1m) ───────────────────────────────────
async function topMoversLeaderboard() {
  try {
    const base = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=5&page=1&sparkline=false';
    const [d1r, d7r, d30r] = await Promise.all([
      fetch(base + '&order=price_change_percentage_24h_desc&price_change_percentage=24h'),
      fetch(base + '&order=price_change_percentage_7d_desc&price_change_percentage=7d'),
      fetch(base + '&order=price_change_percentage_30d_desc&price_change_percentage=30d'),
    ]);
    const [d1, d7, d30] = await Promise.all([
      d1r.ok ? d1r.json() : [],
      d7r.ok ? d7r.json() : [],
      d30r.ok ? d30r.json() : [],
    ]);
    const fmt = (coins, field) => (Array.isArray(coins) ? coins : []).slice(0, 5).map((c, i) => {
      const pct = Number(c[field] || c.price_change_percentage_24h);
      const tag = pct >= 100 ? '🔥' : pct >= 0 ? '🟢' : '🔴';
      return `${i + 1}. <b>$${_esc((c.symbol || '').toUpperCase())}</b>  ${tag} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    }).join('\n');
    const s1  = fmt(d1,  'price_change_percentage_24h');
    const s7  = fmt(d7,  'price_change_percentage_7d_in_currency');
    const s30 = fmt(d30, 'price_change_percentage_30d_in_currency');
    if (!s1 && !s7 && !s30) return null;
    return (
      `📈 <b>TOP MOVERS — 1D · 1W · 1M</b>\n━━━━━━━━━━━━━\n\n` +
      (s1  ? `<b>🕐 24H</b>\n${s1}\n\n`  : '') +
      (s7  ? `<b>📅 7D</b>\n${s7}\n\n`   : '') +
      (s30 ? `<b>🗓 30D</b>\n${s30}`     : '') +
      `\n\n<i>NFA · DYOR</i>`
    );
  } catch (e) { return null; }
}

// ── SHADDAI PROJECT PROMO (timely brand signal) ─────────────────────────────
function projectPromo() {
  const web = process.env.SHADDAI_WEBSITE || 'https://shaddai-g81x.onrender.com';
  const gh = process.env.SHADDAI_GITHUB || 'https://github.com/IzzoSol';
  const x = process.env.SHADDAI_X || 'https://x.com/IzzoSol';
  const lounge = process.env.SHADDAI_LOUNGE || 'https://t.me/EMERALDLOUNGE';
  return (
    '⬡ <b>SHADDAI — Sovereign AI Agents</b>\n\n' +
    'Forge AI agents that live, work &amp; <b>earn</b> across a dashboard, a 2D pixel world and a 3D world. Intelligence you <b>own</b>, not rent — 200+ real tools on your own free keys, on open rails (Solana · x402).\n\n' +
    '🤖 The council: SHADDAI · ZEROX · ORACLE · NEXUS · TURTLE · QUILL · PIKADON\n' +
    '🌿 <b>Emerald Vine</b> — our open community lounge\n' +
    '⭐ <b>Star the GitHub to enter giveaways</b>\n\n' +
    '⭐ Star: ' + _esc(gh) + '\n' +
    '🌐 ' + _esc(web) + '\n' +
    '𝕏 ' + _esc(x) + '  (@IzzoSol)\n' +
    (lounge ? '🌿 Emerald Vine: ' + _esc(lounge) + '\n' : '') +
    '💬 Contact: ' + _esc(process.env.SHADDAI_CONTACT || '@WithLoveWeWinAgain') + '\n' +
    '\n<i>Build your empire. This bot &amp; premium signals are part of it.</i>'
  );
}

let _timer = null, _newsTimer = null, _promoTimer = null, _dexTimer = null, _moversTimer = null;
function startNewsPoster() {
  if (!core.token()) { return; }
  if (_timer) return;
  if (!core.acquireBroadcastLock()) { console.log('[tg-news] another instance owns broadcasting — news not started here.'); return; }

  // ── MARKET PULSE (slowed to 4h default — was flooding) ──────────────────
  const tick = async () => {
    const cfg = core.getConfig();
    if (!cfg.news) return;
    const html = await marketPulse();
    if (html) { const img = _botImage(); await (img ? core.broadcastPhoto(img, html) : core.broadcast(html)); }
  };
  let last = Date.now();   // start at now — prevents immediate fire on Render restart
  _timer = setInterval(async () => {
    const cfg = core.getConfig();
    const everyMs = Math.max(60, cfg.newsIntervalMin || 240) * 60000;   // default 4h (was 2h)
    if (Date.now() - last >= everyMs) { last = Date.now(); tick().catch(() => {}); }
  }, 60000);
  if (_timer.unref) _timer.unref();

  // ── RSS HEADLINES (seed first, then every 90min) ─────────────────────────
  setTimeout(() => { _pollHeadlines().catch(() => {}); }, 6000);
  let lastN = Date.now();   // prevents second fire 60s after the seed-setTimeout above
  _newsTimer = setInterval(async () => {
    const cfg = core.getConfig();
    const everyMs = Math.max(30, cfg.headlinesIntervalMin || 90) * 60000;
    if (Date.now() - lastN >= everyMs) { lastN = Date.now(); _pollHeadlines().catch(() => {}); }
  }, 60000);
  if (_newsTimer.unref) _newsTimer.unref();

  // ── TOP 25 DEXSCREENER (every 4h) ────────────────────────────────────────
  let lastD = Date.now();   // wait a full interval before first post — prevents restart flood
  _dexTimer = setInterval(async () => {
    const cfg = core.getConfig();
    if (cfg.dexTop25 === false) return;
    const everyMs = Math.max(60, cfg.dexTop25IntervalMin || 240) * 60000;
    if (Date.now() - lastD >= everyMs) {
      lastD = Date.now();
      const result = await dexTop25().catch(() => null);
      if (!result || !result.cards || !result.cards.length) return;
      const { cards, ts } = result;

      // Header
      await core.broadcast(`🏆 <b>TOP 25 DEXSCREENER — ◎ SOLANA BOOSTS</b>\n━━━━━━━━━━━━━\n${ts} UTC\n<i>Paid boosts signal project commitment · NFA · DYOR</i>`).catch(() => {});

      // Top 10: one photo card each (token art + full details + copyable CA)
      for (const c of cards.slice(0, 10)) {
        const caption =
          `${c.rank}. <b>${c.sym}</b>${c.name}\n` +
          (c.stats ? `${c.stats}\n` : '') +
          (c.chg   ? `${c.chg}\n`   : '') +
          `\n<code>${c.ca}</code>\n` +
          `<a href="${c.dsUrl}">📊 DexScreener</a>`;
        if (c.icon) {
          await core.broadcastPhoto(c.icon, caption).catch(() => core.broadcast(caption).catch(() => {}));
        } else {
          await core.broadcast(caption).catch(() => {});
        }
        await new Promise(res => setTimeout(res, 400));   // small delay to avoid flood
      }

      // 11-25: compact list
      if (cards.length > 10) {
        const tail = cards.slice(10).map(c =>
          `${c.rank}. <b>${c.sym}</b>${c.name}  ${c.chg || ''}\n` +
          `${c.stats || ''}\n<code>${c.ca}</code>`
        ).join('\n\n');
        await core.broadcast(`<b>11–25</b>\n━━━━━━━━━━━━━\n${tail}`).catch(() => {});
      }
    }
  }, 60000);
  if (_dexTimer.unref) _dexTimer.unref();

  // ── TOP MOVERS 1D/1W/1M (every 6h) ──────────────────────────────────────
  let lastM = Date.now();   // prevents immediate fire on restart
  _moversTimer = setInterval(async () => {
    const cfg = core.getConfig();
    if (cfg.topMovers === false) return;
    const everyMs = Math.max(60, cfg.topMoversIntervalMin || 360) * 60000;
    if (Date.now() - lastM >= everyMs) {
      lastM = Date.now();
      const html = await topMoversLeaderboard().catch(() => null);
      if (html) { const img = _botImage(); (img ? core.broadcastPhoto(img, html) : core.broadcast(html)).catch(() => {}); }
    }
  }, 60000);
  if (_moversTimer.unref) _moversTimer.unref();

  // ── SHADDAI PROJECT PROMO (wait full interval, no spam on restart) ────────
  let lastP = Date.now();
  _promoTimer = setInterval(async () => {
    const cfg = core.getConfig();
    if (cfg.promo === false) return;
    const everyMs = Math.max(30, cfg.promoIntervalMin || 240) * 60000;
    if (Date.now() - lastP >= everyMs) { lastP = Date.now(); const img = _botImage(); (img ? core.broadcastPhoto(img, projectPromo()) : core.broadcast(projectPromo())).catch(() => {}); }
  }, 60000);
  if (_promoTimer.unref) _promoTimer.unref();

  console.log('[tg-news] market-pulse(4h) + headlines(90m) + dex-top25(4h) + movers(6h) + promo armed.');
}

module.exports = { startNewsPoster, marketPulse, projectPromo, dexTop25, topMoversLeaderboard, _pollHeadlines, _botImage };
