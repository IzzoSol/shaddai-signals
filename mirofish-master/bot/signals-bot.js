const cfg = require('./config');
const { Candle, analyze } = require('./ta');
const rugcheck = require('./rugcheck');
const { sendTelegram, sendDiscord } = require('./broadcast');
const paper = require('./paper');
const fs = require('fs');
const path = require('path');

const SENT_FILE = path.join(__dirname, 'signals-state.json');
function loadSent() { try { return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch { return {}; } }
function saveSent() { try { fs.writeFileSync(SENT_FILE, JSON.stringify(state.lastSent)); } catch (e) { console.error('[signals] persist failed:', e.message); } }

const state = { lastSent: loadSent(), running: false };

async function fetchJSON(url, timeout = 10000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return res.json();
}

const KLINE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
async function fetchKlines(symbol) {
  const { interval, limit } = cfg.watch;
  let lastErr;
  for (const host of KLINE_HOSTS) {
    try {
      const data = await fetchJSON(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return data.map(k => new Candle(k));
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function fetchMemePairs() {
  const addrs = cfg.memes.map(m => m.a).join(',');
  const data = await fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${addrs}`, 12000);
  const pairs = data.pairs || [];
  const best = {};
  for (const p of pairs) {
    if (p.chainId !== 'solana') continue;
    const addr = p.baseToken?.address;
    if (!addr) continue;
    if (!best[addr] || (p.liquidity?.usd || 0) > (best[addr].liquidity?.usd || 0)) best[addr] = p;
  }
  return best;
}

function memeSignal(pair) {
  if (!pair) return null;
  const h24 = pair.volume?.h24 || 0, h6 = pair.volume?.h6 || 0, h1 = pair.volume?.h1 || 0;
  const chg = pair.priceChange?.h24 || 0;
  const expected6 = h24 / 4;
  const spike = expected6 > 0 ? h6 / expected6 : 0;
  const liq = pair.liquidity?.usd || 0;
  if (liq < 20000) return null;
  if (spike < 1.8 && Math.abs(chg) < 8) return null;
  const strength = Math.min(95, Math.round(45 + spike * 12 + Math.abs(chg) * 1.2));
  return {
    symbol: (pair.baseToken?.symbol || '?').toUpperCase().replace(/^\$/, ''), mint: pair.baseToken?.address, pair,
    side: chg >= 0 ? 'buy' : 'sell', strength,
    price: parseFloat(pair.priceUsd) || 0,
    text: `${pair.baseToken?.symbol}: ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% 24h, 6h volume ${spike.toFixed(1)}x pace, liq $${Math.round(liq).toLocaleString()}`
  };
}

async function runOnce(dryRun) {
  const signals = [];
  const klineResults = await Promise.allSettled(cfg.watch.binance.map(async s => {
    const candles = await fetchKlines(s);
    const sigs = analyze(s.replace('USDT', ''), candles, cfg.ta).filter(x => x.strength >= cfg.signalMinStrength);
    sigs.forEach(x => { x.price = candles[candles.length - 1].close; });
    return sigs;
  }));
  for (const r of klineResults) if (r.status === 'fulfilled') signals.push(...r.value);

  const pairs = await fetchMemePairs().catch(() => ({}));
  for (const m of cfg.memes) {
    const ms = memeSignal(pairs[m.a]);
    if (!ms || ms.strength < cfg.signalMinStrength) continue;
    const report = await rugcheck.check(m.a).catch(() => null);
    const g = rugcheck.gate(report, cfg.rugcheck);
    if (!g.pass) {
      signals.push({ ...ms, side: 'avoid', strength: ms.strength, rug: true, text: `${ms.symbol}: volume move detected BUT rugcheck flags — ${g.reasons.join('; ')}` });
      continue;
    }
    signals.push({ ...ms, rugScore: g.score, rugCard: rugcheck.formatCard(report, ms.symbol) });
  }

  signals.sort((a, b) => b.strength - a.strength);
  const now = Date.now();
  const fresh = signals.filter(s => {
    const last = state.lastSent[s.symbol + s.code] || 0;
    return now - last > 6 * 3600 * 1000;
  });
  const paperSum = await paper.tick(signals).catch(e => { console.error('[paper] tick failed:', e.message); return null; });
  const digest = buildDigest(fresh.slice(0, cfg.digestMaxSignals), paperSum);
  fresh.slice(0, cfg.digestMaxSignals).forEach(s => { state.lastSent[s.symbol + s.code] = now; });
  saveSent();
  return { digest, sent: fresh.length, paper: paperSum };
}

function buildDigest(signals, paperSum) {
  if (!signals.length) {
    const base = '🐟 MiroFish signals: nothing above threshold this cycle.';
    return paperSum ? base + '\n\n' + paper.digestFooter(paperSum) : base;
  }
  const lines = ['📡 <b>MIROFISH SIGNALS</b> — ' + new Date().toUTCString().slice(0, 22) + ' UTC', ''];
  for (const s of signals) {
    const tag = s.side === 'buy' ? '🟢 BUY' : s.side === 'sell' ? '🔴 SELL' : '⚠️ AVOID';
    lines.push(`${tag} · ${s.strength}% — ${s.text}`);
  }
  const rugCards = signals.filter(s => s.rugCard);
  for (const s of rugCards.slice(0, 2)) lines.push('', s.rugCard);
  if (paperSum) lines.push('', paper.digestFooter(paperSum));
  lines.push('', `Top ${signals.length} qualifying · engine: RSI/volume/divergence + rugcheck gate · paper desk: 4% SL / 12% arm / 6% trail`);
  return lines.join('\n');
}

async function broadcast(digest, dryRun) {
  if (dryRun || (!cfg.telegram.token && !cfg.discord.webhook)) {
    console.log('[dry-run] ' + digest.replace(/<\/?[a-z]+>/g, ''));
    return 'dry-run';
  }
  const results = [];
  if (cfg.telegram.token) results.push(await sendTelegram(cfg.telegram.token, cfg.telegram.chatId, digest).then(() => 'tg:ok').catch(e => 'tg:FAIL ' + e.message));
  if (cfg.discord.webhook) results.push(await sendDiscord(cfg.discord.webhook, digest.replace(/<\/?[a-z]+>/g, '')).then(() => 'dc:ok').catch(e => 'dc:FAIL ' + e.message));
  console.log(results.join(' | '));
  return results.join(' | ');
}

async function main() {
  const once = process.argv.includes('--once');
  const dryRun = process.argv.includes('--dry-run') || (!cfg.telegram.token && !cfg.discord.webhook);
  do {
    try {
      const { digest, sent } = await runOnce(dryRun);
      console.log(`[cycle ${new Date().toISOString()}] ${sent} qualifying signals`);
      await broadcast(digest, dryRun);
    } catch (e) { console.error('[cycle error]', e.message); }
    if (!once) await new Promise(r => setTimeout(r, cfg.loopMinutes * 60000));
  } while (!once);
}

if (require.main === module) main();

module.exports = { runOnce, buildDigest, broadcast };
