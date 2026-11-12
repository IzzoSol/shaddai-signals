/**
 * ZEROX Signal Entry/Exit/SL Calculator
 * For EVERY signal: real-time entry price, TP targets, stop loss, position sizing
 * Solves the "when did 2x happen" problem by giving IMMEDIATE entry/exit levels
 */

const express = require('express');
const router = express.Router();

/**
 * Calculate entry and exit levels for a signal
 * Uses DexScreener live data + risk management rules
 */
async function calculateSignalLevels(coin) {
  try {
    // Fetch live price from DexScreener
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${coin.mint}`);
    const dexData = await dexRes.json();

    if (!dexData.pairs || dexData.pairs.length === 0) {
      return { error: 'Price data not available' };
    }

    const pair = dexData.pairs[0];
    const currentPrice = parseFloat(pair.priceUsd || 0);
    const currentFdv = pair.fdv || coin.entryFdv || 0;
    const liquidity = pair.liquidity?.usd || coin.liquidity || 0;

    // Determine entry strategy based on age and price movement
    const ageHours = (Date.now() - coin.ts) / (1000 * 60 * 60);
    const priceChange = coin.entryPrice ? ((currentPrice / coin.entryPrice) - 1) * 100 : 0;

    let entryStrategy = determineEntryStrategy(ageHours, priceChange, coin.riskTier);

    // Calculate entry zones
    const entryZones = {
      aggressiveEntry: currentPrice * 0.95, // Buy now if you're early
      optimalEntry: currentPrice, // Current price is your entry
      safeEntry: currentPrice * 1.05, // Wait for pullback
    };

    // TP targets based on risk tier and current multiplier
    const tpTargets = calculateTPTargets(coin.riskTier, currentPrice, coin.peakMult || 5);

    // Stop loss (always set one!)
    const stopLoss = calculateStopLoss(coin.riskTier, currentPrice, liquidity);

    // Risk/Reward calculation
    const riskAmount = currentPrice - stopLoss;
    const rewardAmounts = tpTargets.map(t => ({
      ...t,
      reward: t.price - currentPrice,
      riskReward: ((t.price - currentPrice) / riskAmount).toFixed(2),
    }));

    // Position sizing guidance
    const positionSizing = calculatePositionSizing(coin.riskTier, riskAmount);

    return {
      symbol: coin.symbol,
      currentPrice: currentPrice.toFixed(8),
      currentFdv: currentFdv.toFixed(0),
      priceChangePercent: priceChange.toFixed(2),
      ageHours: ageHours.toFixed(1),
      liquidity: liquidity.toFixed(0),

      // ENTRY
      entryStrategy: entryStrategy.name,
      entryReason: entryStrategy.reason,
      entryZones: {
        aggressive: entryZones.aggressiveEntry.toFixed(8),
        optimal: entryZones.optimalEntry.toFixed(8),
        safe: entryZones.safeEntry.toFixed(8),
      },
      recommendedEntry: entryZones.optimalEntry.toFixed(8),

      // EXIT / TAKE PROFIT
      tpTargets: rewardAmounts.map(t => ({
        level: t.level,
        price: t.price.toFixed(8),
        gainPercent: t.gainPercent,
        riskReward: t.riskReward,
        action: t.action,
      })),

      // STOP LOSS
      stopLoss: stopLoss.toFixed(8),
      stopLossPercent: (((stopLoss - currentPrice) / currentPrice) * 100).toFixed(2),

      // POSITION SIZING
      positionSizing: {
        riskPercentRiskier: `Trade smaller: 1-2% account risk`,
        riskPercentMedium: `Standard: 2-3% account risk`,
        riskPercentSafe: `Conservative: 1% account risk`,
        example: {
          accountSize: '$10,000',
          riskAtOnePercent: '$100',
          maximumPositionSize: `${(100 / riskAmount).toFixed(2)} units`,
        },
      },

      // QUICK SUMMARY FOR TG
      telegramSummary: formatForTelegram(coin, currentPrice, entryZones.optimalEntry, rewardAmounts, stopLoss),
    };
  } catch (e) {
    console.error('Signal levels error:', e);
    return { error: e.message };
  }
}

/**
 * Determine entry strategy based on timing and momentum
 */
function determineEntryStrategy(ageHours, priceChange, riskTier) {
  if (ageHours < 1 && priceChange < 50) {
    return {
      name: '🚀 EARLY ENTRY',
      reason: 'Coin <1 hour old, <50% pump — maximum upside potential',
      confidence: 0.9,
    };
  }

  if (ageHours >= 1 && ageHours < 6 && priceChange >= 20 && priceChange <= 200) {
    return {
      name: '⚡ CONFIRMED ENTRY',
      reason: 'Momentum confirmed, good entry window (1-6h old)',
      confidence: 0.85,
    };
  }

  if (ageHours >= 6 && ageHours < 24 && priceChange > 100) {
    return {
      name: '⏰ LATE ENTRY',
      reason: 'Already pumped significantly, wait for pullback or skip',
      confidence: 0.6,
    };
  }

  return {
    name: '❌ MISS WINDOW',
    reason: 'Entry timing not ideal',
    confidence: 0.2,
  };
}

/**
 * Calculate take-profit targets with percentage gains
 */
function calculateTPTargets(riskTier, entryPrice, peakMult) {
  const baseTargets = [
    { level: '1TP (Quick Win)', multiplier: 1.5, gainPercent: 50, action: 'Take 10% profit' },
    { level: '2TP (Secure Gains)', multiplier: 3, gainPercent: 200, action: 'Take 25% profit, hold rest' },
    { level: '3TP (Trail Stop)', multiplier: 5, gainPercent: 400, action: 'Trail stop loss, let it run' },
  ];

  if (peakMult && peakMult > 10) {
    baseTargets.push({
      level: '4TP (Moon)',
      multiplier: 10,
      gainPercent: 900,
      action: 'Trail tight stop, catch the ride',
    });
  }

  return baseTargets.map(t => ({
    ...t,
    price: entryPrice * t.multiplier,
  }));
}

/**
 * Calculate smart stop loss
 * Riskier coins = wider stop, safer coins = tighter stop
 */
function calculateStopLoss(riskTier, entryPrice, liquidity) {
  let stopLossPercent = 20; // Default 20%

  if (riskTier === 'risky') {
    stopLossPercent = 30; // Pre-bond: high volatility, wider stop
  } else if (riskTier === 'medium') {
    stopLossPercent = 15; // Mid-tier: moderate stop
  } else if (riskTier === 'safe') {
    stopLossPercent = 10; // Established: tight stop
  }

  // Adjust for liquidity (low liquidity = wider stop needed)
  if (liquidity < 100000) {
    stopLossPercent += 10; // Add buffer for slippage
  }

  return entryPrice * (1 - stopLossPercent / 100);
}

/**
 * Position sizing guidance
 */
function calculatePositionSizing(riskTier, riskAmount) {
  if (riskTier === 'risky') {
    return { guidance: 'Small position, 1-2% risk max', reason: 'High volatility' };
  } else if (riskTier === 'medium') {
    return { guidance: 'Medium position, 2-3% risk', reason: 'Moderate risk' };
  } else {
    return { guidance: 'Larger position, 3-5% risk', reason: 'Established token' };
  }
}

/**
 * Format everything for a clean Telegram message
 */
function formatForTelegram(coin, currentPrice, entryPrice, tpTargets, stopLoss) {
  return `
🔥 *${coin.symbol}* ENTRY/EXIT LEVELS

📍 *ENTRY ZONE*
• Now: $${currentPrice.toFixed(8)}
• Recommended: $${entryPrice.toFixed(8)}
• Wait: $${(entryPrice * 0.95).toFixed(8)}

🎯 *TAKE PROFIT TARGETS*
${tpTargets.slice(0, 3).map(t => `• ${t.level}: $${t.price.toFixed(8)} (+${t.gainPercent}%)`).join('\n')}

🛑 *STOP LOSS*
• -${Math.round((1 - stopLoss / currentPrice) * 100)}% @ $${stopLoss.toFixed(8)}

⚖️ *RISK/REWARD*
${tpTargets[1]?.riskReward ? `• Best: 1:${tpTargets[1].riskReward}` : '• Calculate based on your position'}

💰 *POSITION SIZE* (for $10k account)
• 1% Risk: ~${(100 / (currentPrice - stopLoss)).toFixed(0)} units
• 2% Risk: ~${(200 / (currentPrice - stopLoss)).toFixed(0)} units

⏰ *ENTRY WINDOW*: <6 hours from launch
  `;
}

// ═══════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/signal-levels/calculate
 * Calculate entry/exit/SL for a signal
 */
router.post('/calculate', async (req, res) => {
  try {
    const { coin } = req.body;
    if (!coin || !coin.mint) {
      return res.json({ error: 'Missing coin data' });
    }

    const levels = await calculateSignalLevels(coin);
    res.json(levels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/signal-levels/:mint
 * Get levels for a specific token by mint address
 */
router.get('/:mint', async (req, res) => {
  try {
    const { mint } = req.params;

    // Fetch from DexScreener
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const dexData = await dexRes.json();

    if (!dexData.pairs || dexData.pairs.length === 0) {
      return res.json({ error: 'Token not found on DEX' });
    }

    const pair = dexData.pairs[0];
    const mockCoin = {
      symbol: pair.baseToken?.symbol || 'UNKNOWN',
      mint: mint,
      ts: Date.now(),
      entryPrice: parseFloat(pair.priceUsd || 0),
      riskTier: 'medium',
      peakMult: 5,
    };

    const levels = await calculateSignalLevels(mockCoin);
    res.json(levels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
