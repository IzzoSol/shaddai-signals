/**
 * ZEROX Signal Forensics
 * Deep analysis of every historical call
 * What made winners win? What made losers lose?
 * Supply, holders, bundle patterns, timing, source analysis
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

/**
 * Categorize all calls as winners, losers, or neutral
 * Returns detailed forensics for each
 */
function analyzeAllCoinsForensics() {
  try {
    const rawCalls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '{"calls":[]}').calls || [];

    // Categorize
    const winners = rawCalls.filter(c => c.peakMult && c.peakMult >= 3);
    const losers = rawCalls.filter(c => c.peakMult && c.peakMult < 1.5);
    const neutrals = rawCalls.filter(c => c.peakMult && c.peakMult >= 1.5 && c.peakMult < 3);

    // Extract patterns from each group
    const winnerPatterns = extractPatterns(winners, 'winner');
    const loserPatterns = extractPatterns(losers, 'loser');
    const neutralPatterns = extractPatterns(neutrals, 'neutral');

    // Compare patterns
    const comparison = comparePatterns(winnerPatterns, loserPatterns);

    // Build strategies based on findings
    const strategies = buildStrategiesFromFindings(winnerPatterns, loserPatterns);

    return {
      summary: {
        totalAnalyzed: rawCalls.length,
        winners: winners.length,
        losers: losers.length,
        neutrals: neutrals.length,
        winRate: ((winners.length / rawCalls.length) * 100).toFixed(1),
      },

      patterns: {
        winners: winnerPatterns,
        losers: loserPatterns,
        neutrals: neutralPatterns,
      },

      comparison: comparison,
      strategies: strategies,

      // Top winners detail
      topWinners: winners
        .sort((a, b) => b.peakMult - a.peakMult)
        .slice(0, 10)
        .map(w => ({
          symbol: w.symbol,
          peakMult: w.peakMult,
          curMult: w.curMult,
          holders: w.holders,
          liquidity: w.liquidity,
          bundleSize: w.bundleSize,
          source: w.source,
          ageHours: ((Date.now() - w.ts) / (1000 * 60 * 60)).toFixed(1),
        })),

      // Top losers detail
      topLosers: losers
        .sort((a, b) => a.peakMult - b.peakMult)
        .slice(0, 10)
        .map(l => ({
          symbol: l.symbol,
          peakMult: l.peakMult,
          curMult: l.curMult,
          holders: l.holders,
          liquidity: l.liquidity,
          bundleSize: l.bundleSize,
          source: l.source,
          ageHours: ((Date.now() - l.ts) / (1000 * 60 * 60)).toFixed(1),
        })),
    };
  } catch (e) {
    console.error('Forensics error:', e);
    return { error: e.message };
  }
}

/**
 * Extract common patterns from a group of coins
 */
function extractPatterns(coins, category) {
  if (coins.length === 0) return null;

  // Source distribution
  const bySource = {};
  coins.forEach(c => {
    const src = c.source || 'unknown';
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(c);
  });

  // Holder distribution
  const holders = coins.filter(c => c.holders).map(c => c.holders);
  const avgHolders = holders.reduce((a, b) => a + b, 0) / holders.length || 0;

  // Bundle distribution
  const bundles = coins.filter(c => c.bundleSize !== undefined).map(c => c.bundleSize);
  const avgBundle = bundles.reduce((a, b) => a + b, 0) / bundles.length || 0;

  // Liquidity distribution
  const liquidity = coins.filter(c => c.liquidity).map(c => c.liquidity);
  const avgLiquidity = liquidity.reduce((a, b) => a + b, 0) / liquidity.length || 0;

  // Multiplier stats
  const multipliers = coins.map(c => c.peakMult || 0);
  const avgMult = multipliers.reduce((a, b) => a + b, 0) / multipliers.length || 0;

  // Entry FDV
  const entryFdvs = coins.filter(c => c.entryFdv).map(c => c.entryFdv);
  const avgEntryFdv = entryFdvs.reduce((a, b) => a + b, 0) / entryFdvs.length || 0;

  return {
    count: coins.length,
    category,
    avgMultiplier: avgMult.toFixed(2),
    avgHolders: Math.round(avgHolders),
    avgBundleSize: avgBundle.toFixed(2),
    avgLiquidity: avgLiquidity.toFixed(0),
    avgEntryFdv: avgEntryFdv.toFixed(0),
    bestSource: Object.entries(bySource)
      .map(([src, items]) => ({ source: src, count: items.length, avgMult: (items.reduce((a, b) => a + (b.peakMult || 0), 0) / items.length).toFixed(2) }))
      .sort((a, b) => b.avgMult - a.avgMult)[0],
    sourceBreakdown: Object.entries(bySource)
      .map(([src, items]) => ({ source: src, count: items.length, avgMult: (items.reduce((a, b) => a + (b.peakMult || 0), 0) / items.length).toFixed(2) }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Compare winner vs loser patterns
 */
function comparePatterns(winners, losers) {
  if (!winners || !losers) return null;

  return {
    multiplier: {
      winners: winners.avgMultiplier,
      losers: losers.avgMultiplier,
      difference: (winners.avgMultiplier - losers.avgMultiplier).toFixed(2),
    },
    holders: {
      winners: winners.avgHolders,
      losers: losers.avgHolders,
      insight: winners.avgHolders > losers.avgHolders ? 'Winners had more community support' : 'Holder count not the main factor',
    },
    bundleSize: {
      winners: winners.avgBundleSize,
      losers: losers.avgBundleSize,
      insight: winners.avgBundleSize < losers.avgBundleSize ? '✅ CRITICAL: Small bundles won more' : '⚠️ Bundles not the deciding factor',
    },
    liquidity: {
      winners: winners.avgLiquidity,
      losers: losers.avgLiquidity,
      insight: winners.avgLiquidity > losers.avgLiquidity ? 'Winners had better liquidity' : 'Liquidity not the main factor',
    },
    entryFdv: {
      winners: winners.avgEntryFdv,
      losers: losers.avgEntryFdv,
      insight: winners.avgEntryFdv < losers.avgEntryFdv ? '✅ CRITICAL: Lower entry FDV = bigger multipliers' : 'Entry FDV not a strong factor',
    },
    bestSource: {
      winners: winners.bestSource?.source,
      losers: losers.bestSource?.source,
    },
  };
}

/**
 * Build concrete trading strategies from forensic findings
 */
function buildStrategiesFromFindings(winners, losers) {
  const strategies = [];

  // Strategy 1: Bundle-based filtering
  strategies.push({
    name: 'Bundle Filter Strategy',
    priority: 1,
    basis: `Winners avg bundle: ${winners.avgBundleSize}%, Losers avg: ${losers.avgBundleSize}%`,
    rules: [
      'CALL signals with bundle < 20%',
      'CAUTION signals with bundle 20-40%',
      'SKIP signals with bundle > 40%',
    ],
    expectedResult: `If followed strictly, should filter out bottom 30% of losers`,
  });

  // Strategy 2: Entry FDV-based scaling
  strategies.push({
    name: 'Early Entry Scaling',
    priority: 2,
    basis: `Winners entry FDV avg: $${winners.avgEntryFdv}, Losers: $${losers.avgEntryFdv}`,
    rules: [
      'Entry FDV < $50K = full position',
      'Entry FDV $50-100K = 50% position',
      'Entry FDV $100-500K = 25% position',
      'Entry FDV > $500K = pass or micro position',
    ],
    expectedResult: `Allocate more capital to earlier, smaller coins = higher average multiplier`,
  });

  // Strategy 3: Source prioritization
  strategies.push({
    name: 'Source Priority Stack',
    priority: 3,
    basis: `Winners best source: ${winners.bestSource?.source}, Losers: ${losers.bestSource?.source}`,
    rules: [
      `Tier 1: ${winners.bestSource?.source} (highest priority)`,
      `Tier 2: Other sources with >1.5x avg`,
      `Tier 3: Sources with <1.5x avg`,
      `Avoid: Known scam sources`,
    ],
    expectedResult: `Concentrated focus on proven sources should improve hit rate`,
  });

  // Strategy 4: Liquidity gates
  strategies.push({
    name: 'Liquidity Gating',
    priority: 4,
    basis: `Winners avg liquidity: $${winners.avgLiquidity}K`,
    rules: [
      `Require minimum $${Math.round(winners.avgLiquidity / 2)}K liquidity`,
      `Prefer $${Math.round(winners.avgLiquidity * 0.8)}K+ for larger positions`,
      `Avoid <$50K liquidity (high slippage)`,
    ],
    expectedResult: `Better exit opportunities, lower slippage, higher realized gains`,
  });

  // Strategy 5: Holder-based validation
  strategies.push({
    name: 'Community Validation',
    priority: 5,
    basis: `Winners avg holders: ${winners.avgHolders}`,
    rules: [
      `Monitor holders growth over first 6 hours`,
      `If holders grow >100%, confidence increases`,
      `If holders flat/decline, exit early`,
      `Use as confirmation, not primary filter`,
    ],
    expectedResult: `Early exit signals prevent holding through dumps`,
  });

  return strategies;
}

// ═══════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/signal-forensics
 * Full forensic analysis of all coins
 */
router.get('/', (req, res) => {
  const forensics = analyzeAllCoinsForensics();
  res.json(forensics);
});

/**
 * GET /api/signal-forensics/strategies
 * Just the strategies part
 */
router.get('/strategies', (req, res) => {
  const forensics = analyzeAllCoinsForensics();
  res.json({
    strategies: forensics.strategies,
    patterns: {
      winners: forensics.patterns.winners,
      losers: forensics.patterns.losers,
    },
    comparison: forensics.comparison,
  });
});

/**
 * GET /api/signal-forensics/winners-vs-losers
 * Detailed comparison
 */
router.get('/winners-vs-losers', (req, res) => {
  const forensics = analyzeAllCoinsForensics();
  res.json({
    topWinners: forensics.topWinners,
    topLosers: forensics.topLosers,
    comparison: forensics.comparison,
    insights: generateInsights(forensics.patterns.winners, forensics.patterns.losers),
  });
});

/**
 * Generate high-level insights
 */
function generateInsights(winners, losers) {
  const insights = [];

  if (winners && losers) {
    if (winners.avgBundleSize < losers.avgBundleSize) {
      insights.push({
        title: '🎯 BUNDLE SIZE IS CRITICAL',
        finding: `Winners had ${winners.avgBundleSize}% avg bundle, losers ${losers.avgBundleSize}%`,
        action: 'Make bundle <20% a hard requirement for signals',
        impact: 'Could eliminate ~40% of bad trades',
      });
    }

    if (winners.avgEntryFdv < losers.avgEntryFdv) {
      insights.push({
        title: '⏰ EARLY ENTRY WINS',
        finding: `Winners avg entry $${winners.avgEntryFdv}K, losers $${losers.avgEntryFdv}K`,
        action: 'Prioritize coins <2 hours old, <$100K FDV',
        impact: 'Earlier entries = bigger multipliers',
      });
    }

    if (winners.avgHolders > losers.avgHolders) {
      insights.push({
        title: '👥 COMMUNITY MATTERS',
        finding: `Winners avg ${winners.avgHolders} holders, losers ${losers.avgHolders}`,
        action: 'Monitor holder growth as confirmation signal',
        impact: 'Early exits when holders decline',
      });
    }
  }

  return insights;
}

module.exports = router;
