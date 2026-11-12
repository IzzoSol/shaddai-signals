/**
 * ZEROX Signal Analysis
 * Analyze all historical calls to extract winning patterns
 * Learn from what actually worked vs what failed
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

/**
 * Analyze all historical calls
 * Returns: winners, losers, patterns, statistics
 */
function analyzeAllCalls() {
  try {
    const calls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '{"calls":[]}').calls || [];

    // Categorize as win/loss/still-open
    const winners = calls.filter(c => c.peakMult && c.peakMult >= 3 && c.curMult && c.curMult >= 2);
    const bigWinners = calls.filter(c => c.peakMult && c.peakMult >= 10);
    const losses = calls.filter(c => c.peakMult && c.peakMult < 1.5);
    const stillOpen = calls.filter(c => !c.closed && c.peakMult && c.curMult === c.peakMult);

    // Analyze by source
    const bySource = {};
    calls.forEach(c => {
      const src = c.source || 'unknown';
      if (!bySource[src]) bySource[src] = { count: 0, wins: 0, avgMult: 0, totalMult: 0 };
      bySource[src].count++;
      if (c.peakMult && c.peakMult >= 3) bySource[src].wins++;
      if (c.peakMult) {
        bySource[src].totalMult += c.peakMult;
        bySource[src].avgMult = bySource[src].totalMult / bySource[src].count;
      }
    });

    // Find best entries (low FDV that went 10x+)
    const homeRuns = calls
      .filter(c => c.entryFdv && c.entryFdv < 100000 && c.peakMult && c.peakMult >= 10)
      .sort((a, b) => b.peakMult - a.peakMult)
      .slice(0, 20);

    // Find common patterns in winners
    const winnerSources = {};
    const winnerHolders = { min: Infinity, max: 0, sum: 0, count: 0 };
    const winnerMilestones = {};

    winners.forEach(w => {
      const src = w.source || 'unknown';
      winnerSources[src] = (winnerSources[src] || 0) + 1;

      if (w.holders) {
        winnerHolders.min = Math.min(winnerHolders.min, w.holders);
        winnerHolders.max = Math.max(winnerHolders.max, w.holders);
        winnerHolders.sum += w.holders;
        winnerHolders.count++;
      }

      if (w.milestones && w.milestones.length > 0) {
        winnerMilestones[w.milestones.length] = (winnerMilestones[w.milestones.length] || 0) + 1;
      }
    });

    return {
      totalCalls: calls.length,
      stats: {
        winners: winners.length,
        bigWinners: bigWinners.length,
        losses: losses.length,
        stillOpen: stillOpen.length,
        winRate: ((winners.length / calls.length) * 100).toFixed(1),
      },
      bySource: bySource,
      homeRuns: homeRuns.map(h => ({
        symbol: h.symbol,
        source: h.source,
        entryFdv: h.entryFdv,
        peakMult: h.peakMult,
        curMult: h.curMult,
        holders: h.holders,
      })),
      winnerPatterns: {
        topSources: Object.entries(winnerSources)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([src, count]) => ({ source: src, winCount: count })),
        avgHolders: Math.round(winnerHolders.sum / winnerHolders.count || 0),
        holderRange: `${Math.round(winnerHolders.min || 0)} - ${Math.round(winnerHolders.max || 0)}`,
        milestonePattern: winnerMilestones,
      },
      recommendations: generateRecommendations(bySource, winners),
    };
  } catch (e) {
    console.error('Analysis error:', e);
    return { error: e.message };
  }
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(bySource, winners) {
  const recommendations = [];

  // Find best source
  const sourceWinRates = Object.entries(bySource).map(([src, data]) => ({
    source: src,
    winRate: ((data.wins / data.count) * 100).toFixed(1),
    avgMult: data.avgMult.toFixed(2),
    count: data.count,
  }));

  const bestSource = sourceWinRates.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))[0];
  recommendations.push({
    priority: 1,
    title: 'Focus on source: ' + bestSource.source,
    reason: `${bestSource.winRate}% win rate, ${bestSource.avgMult}x average multiplier`,
    action: `Prioritize ${bestSource.source} calls, deprioritize others`,
  });

  // Low FDV = higher multiplier
  const lowFdvWinners = winners.filter(w => w.entryFdv && w.entryFdv < 50000);
  if (lowFdvWinners.length > 0) {
    recommendations.push({
      priority: 2,
      title: 'Early entry wins',
      reason: `${lowFdvWinners.length} winners with <$50K entry FDV`,
      action: 'Call coins earlier (lower FDV = higher upside)',
    });
  }

  // Milestone tracking works
  const milestonWinners = winners.filter(w => w.milestones && w.milestones.length > 2);
  if (milestonWinners.length > 0) {
    recommendations.push({
      priority: 3,
      title: 'Milestone momentum matters',
      reason: `${milestonWinners.length} winners hit multiple milestones`,
      action: 'Track milestone hits - they predict continued growth',
    });
  }

  // Holder count correlation
  const highHolderWinners = winners.filter(w => w.holders && w.holders > 1000);
  if (highHolderWinners.length > winners.length * 0.5) {
    recommendations.push({
      priority: 4,
      title: 'Community size matters',
      reason: `${highHolderWinners.length} winners had 1000+ holders`,
      action: 'Favor coins with organic holder growth',
    });
  }

  return recommendations;
}

/**
 * GET /api/signal-analysis
 * Get full analysis of historical calls
 */
router.get('/', (req, res) => {
  const analysis = analyzeAllCalls();
  res.json(analysis);
});

/**
 * GET /api/signal-analysis/winners
 * Get top 20 winners with full details
 */
router.get('/winners', (req, res) => {
  try {
    const calls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '{"calls":[]}').calls || [];

    const winners = calls
      .filter(c => c.peakMult && c.peakMult >= 3)
      .sort((a, b) => b.peakMult - a.peakMult)
      .slice(0, 20)
      .map(w => ({
        symbol: w.symbol,
        source: w.source,
        entryFdv: w.entryFdv,
        peakMult: w.peakMult,
        curMult: w.curMult,
        holders: w.holders,
        liquidity: w.liquidity,
        milestones: w.milestones ? w.milestones.length : 0,
        gainRemaining: w.peakMult && w.curMult ? Math.round(((w.peakMult / w.curMult - 1) * 100)) : 0,
      }));

    res.json({ topWinners: winners, count: winners.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/signal-analysis/by-source
 * Win rate and stats by signal source
 */
router.get('/by-source', (req, res) => {
  try {
    const calls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '{"calls":[]}').calls || [];

    const bySource = {};
    calls.forEach(c => {
      const src = c.source || 'unknown';
      if (!bySource[src]) {
        bySource[src] = {
          count: 0,
          wins: 0,
          losses: 0,
          avgMult: 0,
          totalMult: 0,
          examples: [],
        };
      }
      bySource[src].count++;

      if (c.peakMult >= 3) {
        bySource[src].wins++;
      } else if (c.peakMult < 1.5) {
        bySource[src].losses++;
      }

      if (c.peakMult) {
        bySource[src].totalMult += c.peakMult;
        bySource[src].avgMult = bySource[src].totalMult / bySource[src].count;
      }

      if (bySource[src].examples.length < 3 && c.peakMult >= 2) {
        bySource[src].examples.push(c.symbol || c.name || 'unknown');
      }
    });

    const results = Object.entries(bySource)
      .map(([source, stats]) => ({
        source,
        count: stats.count,
        wins: stats.wins,
        winRate: ((stats.wins / stats.count) * 100).toFixed(1),
        avgMult: stats.avgMult.toFixed(2),
        examples: stats.examples,
      }))
      .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

    res.json({ bySource: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/signal-analysis/patterns
 * Extract common winning patterns
 */
router.get('/patterns', (req, res) => {
  try {
    const calls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '{"calls":[]}').calls || [];

    const winners = calls.filter(c => c.peakMult && c.peakMult >= 5);

    // Low FDV pattern
    const lowFdvWinners = winners.filter(w => w.entryFdv && w.entryFdv < 100000);
    const lowFdvAvgMult = lowFdvWinners.reduce((s, w) => s + w.peakMult, 0) / lowFdvWinners.length || 0;

    // High holder pattern
    const highHolderWinners = winners.filter(w => w.holders && w.holders > 500);
    const highHolderAvgMult = highHolderWinners.reduce((s, w) => s + w.peakMult, 0) / highHolderWinners.length || 0;

    // Milestone pattern
    const milestoneWinners = winners.filter(w => w.milestones && w.milestones.length >= 3);
    const milestoneAvgMult = milestoneWinners.reduce((s, w) => s + w.peakMult, 0) / milestoneWinners.length || 0;

    res.json({
      patterns: {
        lowFdv: {
          name: 'Early Entry Pattern',
          description: 'Entry FDV < $100K',
          count: lowFdvWinners.length,
          avgMult: lowFdvAvgMult.toFixed(2),
          winRate: ((lowFdvWinners.length / winners.length) * 100).toFixed(1),
        },
        highHolders: {
          name: 'Community Pattern',
          description: 'Holders > 500',
          count: highHolderWinners.length,
          avgMult: highHolderAvgMult.toFixed(2),
          winRate: ((highHolderWinners.length / winners.length) * 100).toFixed(1),
        },
        milestones: {
          name: 'Momentum Pattern',
          description: '3+ milestones hit',
          count: milestoneWinners.length,
          avgMult: milestoneAvgMult.toFixed(2),
          winRate: ((milestoneWinners.length / winners.length) * 100).toFixed(1),
        },
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
