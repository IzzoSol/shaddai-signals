/**
 * ZEROX Signal Scoring v3
 * Bundle-focused filtering + all signals shown
 * Learn from live results, not theoretical thresholds
 *
 * Key insight: Bundle size > holder count
 * - Bundles <30 = potential runners (if other metrics green)
 * - Bundles <15 = very high probability if metrics align
 * - Big bundles (>50) = usually dumps, flag them
 * - Locked bundles = safe, less dump risk
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// ═══════════════════════════════════════════════════════════
// BUNDLE DETECTION
// ═══════════════════════════════════════════════════════════

/**
 * Detect if bundle is locked, healthy, or sketchy
 */
function analyzeBundleHealth(coin) {
  const bundleSize = coin.bundleSize || 0;
  const bundlePercent = coin.bundlePercent || 0;
  const bundleLocked = coin.bundleLocked || false;
  const holders = coin.holders || 0;

  let health = {
    size: bundleSize,
    percent: bundlePercent,
    locked: bundleLocked,
    status: 'unknown',
    risk: 'medium',
    reason: '',
  };

  // Tier 1: Tiny bundles (safest)
  if (bundleSize < 5) {
    health.status = 'excellent';
    health.risk = 'low';
    health.reason = 'No whale bundles, organic distribution';
  }
  // Tier 2: Small bundles (good)
  else if (bundleSize < 15) {
    health.status = 'good';
    health.risk = 'low';
    health.reason = 'Small bundles, minimal dump risk';
  }
  // Tier 3: Medium bundles (watch)
  else if (bundleSize < 30) {
    health.status = 'moderate';
    health.risk = 'medium';
    health.reason = 'Medium bundle - possible runner if locked or community is strong';
  }
  // Tier 4: Large bundles (risky)
  else if (bundleSize < 50) {
    health.status = 'risky';
    health.risk = 'high';
    health.reason = 'Large bundle - dump risk if not locked';
  }
  // Tier 5: Huge bundles (very risky)
  else {
    health.status = 'danger';
    health.risk = 'critical';
    health.reason = 'Massive bundle - likely pump/dump scheme';
  }

  // Bonus: locked = safer
  if (bundleLocked) {
    health.status = 'excellent';
    health.risk = 'low';
    health.reason += ' (LOCKED = no dump risk)';
  }

  return health;
}

// ═══════════════════════════════════════════════════════════
// SCORING v3: Bundle-First
// ═══════════════════════════════════════════════════════════

/**
 * Score a coin for signaling
 * Bundle size is PRIMARY factor
 * Show ALL signals, let real results teach us
 */
function scoreSignalV3(coin) {
  let score = 0;
  let flags = [];
  let greenFlags = [];

  // STEP 1: Bundle analysis (PRIMARY)
  const bundleHealth = analyzeBundleHealth(coin);

  if (bundleHealth.risk === 'critical') {
    score -= 40; // Hard penalty for massive bundles
    flags.push('❌ Huge bundle - likely rug');
  } else if (bundleHealth.risk === 'high' && !bundleHealth.locked) {
    score -= 20; // Penalty for large unlocked bundles
    flags.push('⚠️ Large unlocked bundle - dump risk');
  } else if (bundleHealth.risk === 'medium') {
    score += 0; // Neutral, watch closely
  } else if (bundleHealth.risk === 'low') {
    score += 25; // Big bonus for small/locked bundles
    greenFlags.push('✅ Small/locked bundle - safe');
  }

  // STEP 2: DEX paid status (check for pump/dump farms)
  if (coin.dexPaid === false) {
    score += 15; // Not paying for pump = more organic
    greenFlags.push('✅ Not paying DEX - organic launch');
  } else if (coin.dexPaid === true) {
    score -= 10; // Paying for pump = suspicious
    flags.push('⚠️ DEX paid - potential pump scheme');
  }

  // STEP 3: Sniper activity (check for smart money)
  const sniperCount = coin.sniperCount || 0;
  if (sniperCount > 0 && sniperCount < 20) {
    score += 10; // Some snipers = interest, not too many
    greenFlags.push(`✅ ${sniperCount} snipers - smart money interested`);
  } else if (sniperCount >= 20) {
    score += 5; // Too many snipers = less alpha
    flags.push(`⚠️ ${sniperCount} snipers - crowded`);
  } else if (sniperCount === 0) {
    // No data, neutral
  }

  // STEP 4: Liquidity (always needed)
  if (coin.liquidity && coin.liquidity > 50000) {
    score += 12;
    greenFlags.push('✅ Good liquidity ($' + Math.round(coin.liquidity / 1000) + 'K)');
  } else if (coin.liquidity && coin.liquidity < 10000) {
    flags.push('⚠️ Low liquidity - high slippage');
    score -= 5;
  }

  // STEP 5: Age/Timing (early entries = bigger gains)
  const ageHours = (Date.now() - coin.ts) / (1000 * 60 * 60);
  if (ageHours < 2) {
    score += 20;
    greenFlags.push('✅ Very early (<2h) - max upside');
  } else if (ageHours < 6) {
    score += 10;
    greenFlags.push('✅ Early (2-6h) - good entry window');
  } else if (ageHours < 24) {
    score += 5;
  } else {
    score -= 5;
    flags.push('⚠️ Old (>24h) - late entry');
  }

  // STEP 6: Source (trust but verify)
  const source = (coin.source || '').toLowerCase();
  if (source === 'seed' || source === 'bonded') {
    score += 10;
    greenFlags.push('✅ Safe source (seed/bonded)');
  } else if (source === 'trending') {
    score += 0;
  } else if (source.includes('raydium') || source.includes('meteora')) {
    score -= 25;
    flags.push('❌ Blacklisted source');
  }

  return {
    score: Math.max(0, Math.min(score, 100)),
    bundleHealth,
    greenFlags,
    flags,
    recommendation: getRecommendation(score, bundleHealth),
  };
}

/**
 * What should the trader DO with this signal?
 */
function getRecommendation(score, bundleHealth) {
  if (bundleHealth.risk === 'critical') {
    return {
      action: '❌ SKIP',
      reason: 'Pump/dump likely',
      analysis: 'Huge bundle = classic rug pattern. Pass.',
    };
  }

  if (score >= 80) {
    return {
      action: '🚀 STRONG BUY',
      reason: 'All metrics aligned, small bundle, early entry',
      analysis: 'Perfect setup. Enter now, secure profits at 1.5x, let rest run.',
    };
  }

  if (score >= 60) {
    return {
      action: '💚 BUY',
      reason: 'Good metrics, worth testing',
      analysis: 'Solid opportunity. Test with small position, scale if it moves.',
    };
  }

  if (score >= 40) {
    return {
      action: '⏰ WATCH',
      reason: 'Mixed signals, needs more time',
      analysis: 'Monitor for 1-2 hours. Buy if it holds and community grows.',
    };
  }

  return {
    action: '⚠️ CAUTION',
    reason: 'Too many red flags',
    analysis: 'Risk/reward not favorable. Wait for clearer setup.',
  };
}

// ═══════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/signal-scoring/score
 * Score a signal and return recommendation
 */
router.post('/score', (req, res) => {
  try {
    const { coin } = req.body;
    if (!coin || !coin.symbol) {
      return res.json({ error: 'Missing coin data' });
    }

    const evaluation = scoreSignalV3(coin);

    res.json({
      symbol: coin.symbol,
      score: evaluation.score,
      bundleHealth: evaluation.bundleHealth,
      greenFlags: evaluation.greenFlags,
      redFlags: evaluation.flags,
      recommendation: evaluation.recommendation,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/signal-scoring/analysis/:symbol
 * Get deep analysis for a signal
 * What should the trader do?
 */
router.get('/analysis/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;

    // Mock analysis - in production would fetch real data
    const mockCoin = {
      symbol,
      bundleSize: 12,
      bundleLocked: true,
      bundlePercent: 8,
      dexPaid: false,
      sniperCount: 5,
      liquidity: 250000,
      ts: Date.now(),
      source: 'bonded',
    };

    const evaluation = scoreSignalV3(mockCoin);

    const deepAnalysis = {
      symbol,
      overallScore: evaluation.score,
      verdict: evaluation.recommendation.action,

      // Detailed breakdown
      bundle: {
        size: evaluation.bundleHealth.size,
        status: evaluation.bundleHealth.status,
        risk: evaluation.bundleHealth.risk,
        reason: evaluation.bundleHealth.reason,
        action: evaluation.bundleHealth.risk === 'low'
          ? 'Safe to enter'
          : evaluation.bundleHealth.risk === 'medium'
          ? 'Monitor closely'
          : 'Avoid or wait',
      },

      entry: {
        recommendation: evaluation.recommendation.action,
        reason: evaluation.recommendation.reason,
        detailed: evaluation.recommendation.analysis,
      },

      strategy: {
        if_score_high: {
          action: 'Enter immediately at market',
          tp1: 'Take 10% at 1.5x',
          tp2: 'Take 25% at 3x',
          tp3: 'Trail stop, let rest run to 5x+',
        },
        if_score_medium: {
          action: 'Small test position',
          tp1: 'Sell 50% at 1.2x',
          tp2: 'Move stop to breakeven',
          tp3: 'Hold rest with tight trail',
        },
        if_score_low: {
          action: 'Wait or skip',
          reason: 'Risk/reward not favorable',
        },
      },

      metrics: {
        greenFlags: evaluation.greenFlags,
        redFlags: evaluation.flags,
      },
    };

    res.json(deepAnalysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/signal-scoring/batch
 * Score multiple signals at once
 * Returns all signals ranked by score
 */
router.post('/batch', (req, res) => {
  try {
    const { coins } = req.body;

    if (!Array.isArray(coins)) {
      return res.json({ error: 'Expected array of coins' });
    }

    const scored = coins
      .map(coin => ({
        ...coin,
        evaluation: scoreSignalV3(coin),
      }))
      .sort((a, b) => b.evaluation.score - a.evaluation.score)
      .map(c => ({
        symbol: c.symbol,
        score: c.evaluation.score,
        recommendation: c.evaluation.recommendation.action,
        bundle: c.evaluation.bundleHealth,
        flags: c.evaluation.flags,
      }));

    res.json({
      totalScored: scored.length,
      highPriority: scored.filter(s => s.score >= 80),
      medium: scored.filter(s => s.score >= 50 && s.score < 80),
      low: scored.filter(s => s.score < 50),
      allScored: scored,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
