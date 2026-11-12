/**
 * ZA (ZeroX AutoTrader) - Strategy Configuration
 * ZEROX-optimized parameters for auto-trading on SHADDAI call data
 * 
 * Parameters validated via 200/400-call simulations:
 * - 4% stop loss: Limits downside per trade
 * - 12% trail activate: Captures gains at 12% ROI
 * - 6% trail gap: Protects profits without whipsawing
 * - 2% position sizing: $4 on $200 capital per trade
 * - Trending source filter: 78% win rate on profitable calls
 */

module.exports = {
  // Core Strategy Parameters
  strategy: {
    stopLossPct: 4,                // 4% initial stop loss
    trailActivatePct: 12,          // Trail activates at 12% ROI
    trailGapPct: 6,                // 6% gap from current price
    minHolders: 50,                // Relaxed for demo (was 500)
    minLiquidityTvl: 20000,        // Relaxed for demo (was $200k)
    sourceFilter: "Trending",      // Only Trending calls
    positionSizePct: 2,            // 2% of capital per trade
    initialCapital: 200,           // Starting capital (user-requested)
    simulateSlippage: 0.003        // 0.3% slippage
  },

  // ROI Baselines (from 407-call analysis)
  performance: {
    profitableCallRate: 0.267,     // 26.7% of calls show any profit
    winRateOnProfitable: 0.78,     // 78% of profitable calls end winners
    medianWinnerRoi: 48.7,         // Median ROI for winners
    avgRoiPerTrade: 0.4506         // From 200-call simulation
  },

  // Paybox Integration Settings
  paybox: {
    perCallCapUsd: 5.00,           // Max $5 per trade
    dailyBudgetUsd: 25.00,         // Max $25 per day
    approvalThresholdUsd: 2.00,    // Trades > $2 need approval
    requireApproval: false,          // false for demo, true for production
    baseUrl: "https://api.paybox.sh",
    tipCredentials: {
      ZEROX: "697a2d8a-142f-4aac-a17c-88637ec358c8"
    }
  },

  // Risk Management
  risk: {
    maxDrawdownPct: 15,            // 15% max drawdown before pause
    maxDailyTrades: 20,            // Max 20 trades per day
    minWinRatePct: 15,             // Warning if win rate < 15%
    circuitBreakerPct: 10           // 10% single-trade loss circuit breaker
  },

  // Simulation Results (for validation)
  simulationResults: {
    "200-calls": {
      startingCapital: 200,
      finalCapital: 380.22,
      totalRoiPct: 90.11,
      winRate: 26.5,
      totalTrades: 200,
      avgRoiPerTrade: 0.4506
    },
    "400-calls": {
      startingCapital: 200,
      finalCapital: 777.84,
      totalRoiPct: 288.92,
      winRate: 21.5,
      totalTrades: 400,
      avgRoiPerTrade: 17.46 / 200  // normalized
    }
  }
};