/* ══════════════════════════════════════════════════════════════════
   tools-markets.js — REAL markets/finance tools (ZEROX). Keyless APIs:
   Frankfurter (FX), CoinGecko (crypto), DeFiLlama (TVL/yields), Yahoo
   Finance chart (stocks). Every executor returns live data.
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const ok = (o) => JSON.stringify(o);
const err = (e) => JSON.stringify({ error: (e && e.message) || String(e) });
async function gj(url, opts) { const r = await fetch(url, Object.assign({ headers: { 'user-agent': 'SHADDAI/1.0' } }, opts || {})); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
function tool(name, desc, schema, agents, fn) { return { name, description: desc, schema: schema || {}, agents: agents || ['ZEROX', 'ORACLE'], category: 'Markets & Finance', async execute(p = {}) { try { return await fn(p || {}); } catch (e) { return err(e); } } }; }
const M = ['ZEROX', 'ORACLE', 'SHADDAI'];
const TOOLS_MARKETS = {};
const reg = (t) => { TOOLS_MARKETS[t.name] = t; };

reg(tool('forex_rate', 'Live exchange rate between two currencies (Frankfurter/ECB).', { from: 'string — e.g. USD', to: 'string — e.g. EUR' }, M, async (p) => {
  const from = String(p.from || 'USD').toUpperCase(), to = String(p.to || 'EUR').toUpperCase();
  const d = await gj(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
  return ok({ from, to, rate: d.rates[to], date: d.date });
}));
reg(tool('forex_convert', 'Convert an amount between currencies at the live rate.', { amount: 'number', from: 'string', to: 'string' }, M, async (p) => {
  const from = String(p.from || 'USD').toUpperCase(), to = String(p.to || 'EUR').toUpperCase(), amt = Number(p.amount) || 1;
  const d = await gj(`https://api.frankfurter.app/latest?amount=${amt}&from=${from}&to=${to}`);
  return ok({ amount: amt, from, to, converted: d.rates[to], date: d.date });
}));
reg(tool('forex_historical', 'Historical FX rate on a given date.', { date: 'string — YYYY-MM-DD', from: 'string', to: 'string' }, M, async (p) => {
  const from = String(p.from || 'USD').toUpperCase(), to = String(p.to || 'EUR').toUpperCase();
  const d = await gj(`https://api.frankfurter.app/${encodeURIComponent(p.date)}?from=${from}&to=${to}`);
  return ok({ date: d.date, from, to, rate: d.rates[to] });
}));
reg(tool('currency_list', 'List all supported currency codes + names.', {}, M, async () => ok({ currencies: await gj('https://api.frankfurter.app/currencies') })));

reg(tool('stock_quote', 'Live stock quote (price, change, day range) via Yahoo Finance.', { symbol: 'string — ticker e.g. AAPL' }, M, async (p) => {
  const s = String(p.symbol || 'AAPL').toUpperCase();
  const d = await gj(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}`);
  const m = d.chart.result[0].meta;
  return ok({ symbol: s, price: m.regularMarketPrice, prevClose: m.chartPreviousClose, change: Math.round((m.regularMarketPrice - m.chartPreviousClose) * 100) / 100, dayHigh: m.regularMarketDayHigh, dayLow: m.regularMarketDayLow, currency: m.currency, exchange: m.exchangeName });
}));
reg(tool('stock_history', 'Recent daily closes for a stock (last ~1mo) via Yahoo Finance.', { symbol: 'string — ticker' }, M, async (p) => {
  const s = String(p.symbol || 'AAPL').toUpperCase();
  const d = await gj(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1mo&interval=1d`);
  const r = d.chart.result[0]; const ts = r.timestamp || []; const cl = r.indicators.quote[0].close || [];
  const rows = ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: cl[i] != null ? Math.round(cl[i] * 100) / 100 : null })).filter((x) => x.close != null).slice(-10);
  return ok({ symbol: s, recent: rows });
}));

reg(tool('crypto_global', 'Global crypto market — total mcap, 24h volume, BTC dominance.', {}, M, async () => {
  const d = await gj('https://api.coingecko.com/api/v3/global'); const g = d.data;
  return ok({ totalMarketCapUsd: Math.round(g.total_market_cap.usd), volume24hUsd: Math.round(g.total_volume.usd), btcDominance: Math.round(g.market_cap_percentage.btc * 100) / 100 + '%', activeCoins: g.active_cryptocurrencies, marketCapChange24h: Math.round(g.market_cap_change_percentage_24h_usd * 100) / 100 + '%' });
}));
reg(tool('crypto_categories', 'Top crypto categories by market cap (CoinGecko).', {}, M, async () => {
  const d = await gj('https://api.coingecko.com/api/v3/coins/categories');
  return ok({ top: d.slice(0, 12).map((c) => ({ name: c.name, mcap: Math.round(c.market_cap || 0), change24h: c.market_cap_change_24h != null ? Math.round(c.market_cap_change_24h * 100) / 100 + '%' : null })) });
}));
reg(tool('crypto_price_history', 'Daily price history for a coin over N days (CoinGecko).', { coin: 'string — id e.g. bitcoin', days: 'number — default 7' }, M, async (p) => {
  const id = String(p.coin || 'bitcoin').toLowerCase(), days = Math.max(1, Math.min(90, Number(p.days) || 7));
  const d = await gj(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`);
  return ok({ coin: id, days, prices: (d.prices || []).map((x) => ({ date: new Date(x[0]).toISOString().slice(0, 10), usd: Math.round(x[1] * 100) / 100 })) });
}));
reg(tool('crypto_exchanges', 'Top crypto exchanges by trust score / volume (CoinGecko).', {}, M, async () => {
  const d = await gj('https://api.coingecko.com/api/v3/exchanges?per_page=12&page=1');
  return ok({ exchanges: d.map((e) => ({ name: e.name, country: e.country, trustRank: e.trust_score_rank, volumeBtc24h: Math.round(e.trade_volume_24h_btc) })) });
}));

reg(tool('defillama_protocols', 'Top DeFi protocols by TVL (DeFiLlama).', {}, M, async () => {
  const d = await gj('https://api.llama.fi/protocols');
  return ok({ top: d.sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 12).map((x) => ({ name: x.name, chain: x.chain, category: x.category, tvlUsd: Math.round(x.tvl || 0), change1d: x.change_1d != null ? Math.round(x.change_1d * 100) / 100 + '%' : null })) });
}));
reg(tool('defillama_chains', 'Total DeFi TVL per blockchain (DeFiLlama).', {}, M, async () => {
  const d = await gj('https://api.llama.fi/v2/chains');
  return ok({ top: d.sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 12).map((x) => ({ chain: x.name, tvlUsd: Math.round(x.tvl || 0), token: x.tokenSymbol })) });
}));
reg(tool('defillama_stablecoins', 'Top stablecoins by circulating market cap (DeFiLlama).', {}, M, async () => {
  const d = await gj('https://stablecoins.llama.fi/stablecoins?includePrices=true');
  return ok({ top: (d.peggedAssets || []).slice(0, 10).map((x) => ({ name: x.name, symbol: x.symbol, circulating: Math.round((x.circulating && x.circulating.peggedUSD) || 0), price: x.price })) });
}));
reg(tool('defillama_yields', 'Top DeFi yield pools by APY (DeFiLlama).', { min_tvl: 'number — min pool TVL USD (default 1000000)' }, M, async (p) => {
  const d = await gj('https://yields.llama.fi/pools'); const min = Number(p.min_tvl) || 1e6;
  const pools = (d.data || []).filter((x) => (x.tvlUsd || 0) >= min).sort((a, b) => (b.apy || 0) - (a.apy || 0)).slice(0, 12);
  return ok({ pools: pools.map((x) => ({ project: x.project, chain: x.chain, symbol: x.symbol, apy: Math.round((x.apy || 0) * 100) / 100 + '%', tvlUsd: Math.round(x.tvlUsd || 0) })) });
}));

module.exports = { TOOLS_MARKETS, _count: Object.keys(TOOLS_MARKETS).length };
