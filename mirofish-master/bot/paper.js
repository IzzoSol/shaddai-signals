const cfg = require('./config');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'paper-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { capital: cfg.strategy.initialCapital, positions: [], closed: [], stats: { trades: 0, wins: 0, losses: 0, realized: 0 }, dailySpend: 0, day: '' }; }
}
function persist(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) { console.error('[paper] persist failed:', e.message); } }
function rollDay(s) {
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today) { s.day = today; s.dailySpend = 0; }
}

function applyRules(p, price) {
  const roi = (price / p.entry - 1) * 100;
  p.hwm = Math.max(p.hwm || p.entry, price);
  if (roi <= -cfg.strategy.stopLossPct) return { close: true, reason: 'stop_loss', roi };
  if (roi >= cfg.strategy.trailActivatePct) p.trailArmed = true;
  if (p.trailArmed && price <= p.hwm * (1 - cfg.strategy.trailGapPct / 100)) return { close: true, reason: 'trail_exit', roi };
  return { close: false, roi };
}

function closePosition(s, p, price, reason) {
  const pnl = (price / p.entry - 1) * p.size;
  s.capital += pnl;
  s.stats.trades++;
  if (pnl >= 0) s.stats.wins++; else s.stats.losses++;
  s.stats.realized += pnl;
  s.closed.push({ ...p, exitPrice: price, exitAt: new Date().toISOString(), reason, pnl: +pnl.toFixed(4) });
  if (s.closed.length > 200) s.closed.shift();
  s.positions = s.positions.filter(x => x.id !== p.id);
  return pnl;
}

async function fetchPrices(symbols) {
  const prices = {};
  const memeSet = new Map(cfg.memes.map(m => [m.s, m.a]));
  const binanceSyms = symbols.filter(x => !memeSet.has(x)).map(x => x + 'USDT');
  const memeSyms = symbols.filter(x => memeSet.has(x));
  const normKey = s => String(s || '').toUpperCase().replace(/^\$/, '');
  if (binanceSyms.length) {
    const hosts = ['https://api.binance.com', 'https://data-api.binance.vision'];
    for (const host of hosts) {
      try {
        const res = await fetch(host + '/api/v3/ticker/price?symbols=' + encodeURIComponent(JSON.stringify(binanceSyms)), { signal: AbortSignal.timeout(8000) });
        if (res.ok) { (await res.json()).forEach(t => { prices[t.symbol.replace(/USDT$/, '')] = parseFloat(t.price); }); break; }
      } catch {}
    }
  }
  if (memeSyms.length) {
    try {
      const addrs = memeSyms.map(s => memeSet.get(s)).join(',');
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + addrs, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const pairs = (await res.json()).pairs || [];
        const best = {};
        pairs.forEach(p => {
          if (p.chainId !== 'solana') return;
          const sym = p.baseToken && p.baseToken.symbol;
          if (!sym) return;
          const key = normKey(sym);
          if (!best[key] || (p.liquidity?.usd || 0) > (best[key].liquidity?.usd || 0)) best[key] = p;
        });
        Object.entries(best).forEach(([key, p]) => { if (p.priceUsd) prices[key] = parseFloat(p.priceUsd); });
      }
    } catch {}
  }
  return prices;
}

async function tick(signals) {
  const s = loadState();
  rollDay(s);
  const openSyms = s.positions.map(p => p.symbol);
  const prices = await fetchPrices(openSyms);

  for (const p of [...s.positions]) {
    const rawPrice = prices[p.symbol];
    if (!rawPrice) continue;
    const r = applyRules(p, rawPrice);
    if (r.close) {
      const exitPrice = rawPrice * (1 - cfg.strategy.simulateSlippage);
      const pnl = closePosition(s, p, exitPrice, r.reason);
      console.log(`[paper] CLOSED ${p.symbol} (${r.reason}) roi ${r.roi.toFixed(2)}% pnl $${pnl.toFixed(2)} capital $${s.capital.toFixed(2)}`);
    }
  }

  const buys = (signals || []).filter(x => x.side === 'buy' && !x.rug && x.price).sort((a, b) => b.strength - a.strength);
  for (const b of buys) {
    if (s.positions.length >= 5) break;
    if (s.positions.some(p => p.symbol === b.symbol)) continue;
    const size = Math.min(cfg.strategy.maxPerTradeUsd, s.capital * cfg.strategy.positionSizePct / 100, cfg.risk.dailyBudgetUsd - s.dailySpend);
    if (size < 1) break;
    s.positions.push({ id: 'pos_' + Date.now() + '_' + b.symbol, symbol: b.symbol, source: b.code || 'meme', entry: b.price * (1 + cfg.strategy.simulateSlippage), size: +size.toFixed(2), hwm: b.price, openedAt: new Date().toISOString() });
    s.dailySpend += size;
    console.log(`[paper] OPENED ${b.symbol} @ ${b.price} size $${size.toFixed(2)} (${b.code || 'meme'}, ${b.strength}%)`);
  }

  const unrealized = s.positions.reduce((a, p) => a + ((prices[p.symbol] || p.entry) / p.entry - 1) * p.size, 0);
  persist(s);
  return summary(s, prices, unrealized);
}

function summary(s, prices, unrealized) {
  const equity = s.capital + unrealized;
  const roi = ((equity - cfg.strategy.initialCapital) / cfg.strategy.initialCapital) * 100;
  const wr = s.stats.trades ? (s.stats.wins / s.stats.trades * 100).toFixed(0) : '0';
  return {
    equity: +equity.toFixed(2), roi: +roi.toFixed(2),
    open: s.positions.length, closed: s.stats.trades,
    wins: s.stats.wins, losses: s.stats.losses, winRate: wr,
    realized: +s.stats.realized.toFixed(2), unrealized: +unrealized.toFixed(2),
    dailySpend: +s.dailySpend.toFixed(2)
  };
}

function digestFooter(sum) {
  return `📈 Paper desk: $${sum.equity} equity (${sum.roi >= 0 ? '+' : ''}${sum.roi}%) · ${sum.open} open · ${sum.closed} closed · WR ${sum.winRate}% · realized $${sum.realized} · spent today $${sum.dailySpend}/${cfg.risk.dailyBudgetUsd}`;
}

module.exports = { tick, applyRules, loadState, summary, digestFooter, fetchPrices };

if (require.main === module) {
  let fails = 0;
  const p1 = { id: 't1', symbol: 'T', entry: 100, size: 5, hwm: 100 };
  let r = applyRules(p1, 95.9);
  if (!r.close || r.reason !== 'stop_loss') { console.error('FAIL stop-loss'); fails++; }
  const p2 = { id: 't2', symbol: 'T', entry: 100, size: 5, hwm: 100 };
  r = applyRules(p2, 113);
  if (r.close || p2.hwm !== 113) { console.error('FAIL trail arm'); fails++; }
  r = applyRules(p2, 106);
  if (!r.close || r.reason !== 'trail_exit') { console.error('FAIL trail exit'); fails++; }
  const p3 = { id: 't3', symbol: 'T', entry: 100, size: 5, hwm: 100 };
  applyRules(p3, 111);
  r = applyRules(p3, 108);
  if (r.close) { console.error('FAIL false trail exit'); fails++; }
  if (fails) { console.error(`${fails} TEST(S) FAILED`); process.exit(1); }
  console.log('PAPER RULES SELF-TEST OK (SL 4% / arm 12% / trail 6%)');
}
