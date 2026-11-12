const cfg = require('./config');

const state = {
  capital: cfg.strategy.initialCapital,
  peak: cfg.strategy.initialCapital,
  dailySpend: 0,
  tradesToday: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  paused: false,
  lastDay: new Date().toISOString().slice(0, 10)
};

function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastDay !== today) {
    state.lastDay = today;
    state.dailySpend = 0;
    state.tradesToday = 0;
  }
}

function riskChecks() {
  rollDay();
  const drawdown = state.peak > 0 ? (state.peak - state.capital) / state.peak * 100 : 0;
  if (drawdown >= cfg.risk.maxDrawdownPct) { state.paused = true; return { ok: false, reason: `circuit breaker: drawdown ${drawdown.toFixed(1)}% >= ${cfg.risk.maxDrawdownPct}%` }; }
  if (state.dailySpend >= cfg.risk.dailyBudgetUsd) return { ok: false, reason: `daily budget cap $${cfg.risk.dailyBudgetUsd} hit` };
  if (state.tradesToday >= cfg.risk.maxDailyTrades) return { ok: false, reason: `max ${cfg.risk.maxDailyTrades} daily trades hit` };
  if (state.paused) return { ok: false, reason: 'engine paused by circuit breaker — manual reset required' };
  return { ok: true, drawdown };
}

function executeTrade(call) {
  const check = riskChecks();
  if (!check.ok) { console.log('[blocked]', check.reason); return null; }

  let positionSizeUsd = state.capital * (cfg.strategy.positionSizePct / 100);
  positionSizeUsd = Math.min(positionSizeUsd, cfg.risk.dailyBudgetUsd - state.dailySpend, cfg.strategy.maxPerTradeUsd);
  if (positionSizeUsd <= 0) { console.log('[blocked] no position budget left'); return null; }

  const isProfitable = Math.random() < 0.267;
  let roiPct, tradeType;
  if (isProfitable && Math.random() < 0.78) {
    const mu = Math.log(cfg.strategy.medianWinnerRoi || 48.7);
    roiPct = Math.max(0.5, Math.min(500, Math.exp(mu + 1.5 * (Math.random() - 0.5) * 2)));
    tradeType = 'winner';
  } else if (isProfitable) {
    roiPct = Math.random() * 5;
    tradeType = 'small_profit';
  } else {
    roiPct = -cfg.strategy.stopLossPct - 0.3 + (Math.random() * 2 - 1);
    tradeType = 'stop_loss';
  }
  roiPct *= (1 - cfg.strategy.simulateSlippage);

  const pnl = positionSizeUsd * roiPct / 100;
  state.capital += pnl;
  state.peak = Math.max(state.peak, state.capital);
  state.dailySpend += positionSizeUsd;
  state.tradesToday++;
  state.totalTrades++;
  if (pnl >= 0) state.wins++; else state.losses++;
  if (roiPct <= -cfg.risk.circuitBreakerLossPct) console.log('[breaker] single-trade loss exceeded', cfg.risk.circuitBreakerLossPct + '% — reviewing next entry');

  return { tradeType, roiPct: +roiPct.toFixed(2), pnl: +pnl.toFixed(2), positionSizeUsd: +positionSizeUsd.toFixed(2), capital: +state.capital.toFixed(2), timestamp: new Date().toISOString() };
}

function getStatus() {
  rollDay();
  const drawdown = state.peak > 0 ? ((state.peak - state.capital) / state.peak * 100) : 0;
  return {
    capital: +state.capital.toFixed(2),
    peak: +state.peak.toFixed(2),
    totalROI: +(((state.capital - cfg.strategy.initialCapital) / cfg.strategy.initialCapital) * 100).toFixed(2),
    totalTrades: state.totalTrades,
    wins: state.wins, losses: state.losses,
    winRate: state.totalTrades ? +(state.wins / state.totalTrades * 100).toFixed(1) : 0,
    dailySpend: +state.dailySpend.toFixed(2),
    dailyBudgetLeft: +(cfg.risk.dailyBudgetUsd - state.dailySpend).toFixed(2),
    drawdown: +drawdown.toFixed(2),
    paused: state.paused
  };
}

function reset() {
  Object.assign(state, { capital: cfg.strategy.initialCapital, peak: cfg.strategy.initialCapital, dailySpend: 0, tradesToday: 0, totalTrades: 0, wins: 0, losses: 0, paused: false });
}

function generateMockCalls(count) {
  const sources = ['Trending', 'Bonded', 'Seed'];
  return Array.from({ length: count }, (_, i) => ({
    mint: 'token_' + i,
    source: sources[i % 3],
    holders: [100, 500, 2000][i % 3],
    liquidityTvl: [5000, 50000, 200000][i % 3],
    ts: Date.now() - Math.random() * 86400000
  }));
}

function runSimulation(calls) {
  const list = calls || generateMockCalls(50);
  for (const call of list) {
    if (state.paused) { console.log('[paused] circuit breaker active, stopping'); break; }
    const r = executeTrade(call);
    if (r) console.log(`#${state.totalTrades} ${r.tradeType} roi ${r.roiPct}% pnl $${r.pnl} capital $${r.capital} dailySpend $${state.dailySpend}`);
  }
  return getStatus();
}

module.exports = { executeTrade, getStatus, reset, runSimulation, generateMockCalls, riskChecks, state };

if (require.main === module) {
  const status = runSimulation();
  console.log('\nFINAL:', JSON.stringify(status, null, 2));
}
