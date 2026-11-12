/**
 * ZA (ZeroX AutoTrader) - PIKADON Security Integration
 * Pre-trade and post-trade security auditing
 */

const security = {
  
  // ─── PRE-TRADE SECURITY CHECKS ──────────────────────────────
  preTradeAudit: function(callData) {
    const auditResults = {
      safe: true,
      warnings: [],
      blocks: []
    };
    
    // Check 1: Source verification
    const validSources = ["Trending", "Bonded"];
    if (!validSources.includes(callData.source)) {
      auditResults.safe = false;
      auditResults.blocks.push(`Invalid source: ${callData.source}. Must be one of ${validSources.join(", ")}`);
    }
    
    // Check 2: Holder minimum
    if (callData.holders < 50) {
      auditResults.warnings.push(`Low holder count: ${callData.holders}. Minimum recommended: 50`);
    }
    
    // Check 3: Liquidity minimum
    if (callData.liquidityTvl < 20000) {
      auditResults.warnings.push(`Low liquidity: $${callData.liquidityTvl}. Minimum recommended: $20k`);
    }
    
    // Check 4: FDV/dead call check
    const callAgeHours = (Date.now() - callData.ts) / 3600000;
    if (callAgeHours > 1 && callData.curMult < 0.8) {
      auditResults.safe = false;
      auditResults.blocks.push(`Dead call: FDV ≤ $4k for ${callAgeHours.toFixed(1)}h old call`);
    }
    
    // Check 5: Price sanity
    if (callData.entryPrice <= 0) {
      auditResults.safe = false;
      auditResults.blocks.push(`Invalid entry price: $${callData.entryPrice}`);
    }
    
    // Check 6: Cur multipli sanity
    if (callData.curMult > 100) {
      auditResults.warnings.push(`Extreme price movement: curMult=${callData.curMult}`);
    }
    
    return auditResults;
  },
  
  // ─── POST-TRADE AUDIT ───────────────────────────────────────
  postTradeAudit: function(tradeResult) {
    const auditResults = {
      compliant: true,
      warnings: [],
      recommendations: []
    };
    
    // Check 1: ROI within expected range
    const expectedRange = { min: -5, max: 150 }; // Based on 407-call data
    if (tradeResult.roiPct < expectedRange.min || tradeResult.roiPct > expectedRange.max) {
      auditResults.warnings.push(`ROI outside expected range: ${tradeResult.roiPct}% (expected: ${expectedRange.min}-${expectedRange.max}%)`);
    }
    
    // Check 2: Position sizing compliance
    const maxPositionPct = 5; // 5% max per the config
    const positionPct = Math.abs(tradeResult.pnl) / (tradeResult.positionSizeUsd || 1) * 100;
    if (positionPct > maxPositionPct) {
      auditResults.recommendations.push(`Position size proportionally high: ${positionPct.toFixed(1)}% of trade value`);
    }
    
    // Check 3: Daily budget compliance
    if (tradeResult.positionSizeUsd && dailySpendTracker) {
      const dailyTotal = (dailySpendTracker + tradeResult.positionSizeUsd);
      if (dailyTotal > 25) {
        auditResults.warnings.push(`Daily budget would exceed $25: $${dailyTotal.toFixed(2)}`);
      }
    }
    
    // Check 4: Stop loss compliance
    if (tradeResult.tradeType === "stop_loss" && tradeResult.roiPct < -4) {
      auditResults.recommendations.push(`Stop loss triggered beyond 4%: ${tradeResult.roiPct}%. Review strategy parameters.`);
    }
    
    // Check 4: Profit factor
    if (tradeResult.roiPct > 0) {
      auditResults.recommendations.push(`Positive trade captured: ${tradeResult.roiPct}% ROI. Consider trailing stop for future trades.`);
    }
    
    return auditResults;
  },
  
  // ─── DAILY RISK REPORT ───────────────────────────────────────
  dailyRiskReport: function() {
    const totalTrades = (globalThis || global).tradeCount || 0;
    const wins = (globalThis || global).wins || 0;
    const losses = (globalThis || global).losses || 0;
    const capital = (globalThis || global).capital || 200;
    const dailySpend = (globalThis || global).dailySpend || 0;
    
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalRoi = ((capital - 200) / 200) * 100;
    const remainingBudget = 25 - dailySpend;
    
    return {
      date: new Date().toISOString().split("T")[0],
      totalTrades,
      wins,
      losses,
      winRate: winRate.toFixed(1),
      totalRoi: totalRoi.toFixed(2),
      dailySpend: dailySpend.toFixed(2),
      remainingDailyBudget: remainingBudget.toFixed(2),
      riskLevel: winRate > 20 && totalRoi > 0 ? "LOW" : 
                 winRate > 10 ? "MEDIUM" : "HIGH",
      recommendations: []
    };
  }
};

module.exports = security;