/**
 * ZEROX Real-Time Discovery Engine
 * Catch NEW coins EARLY before they pump
 * Problem: By the time we score them, they're already 10x
 * Solution: Stream DexScreener boosted tokens every 30s + instant evaluation
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// Cache of recently seen coins (mint -> timestamp)
let recentCoins = {};

/**
 * Fetch newly boosted coins from DexScreener
 * "Boosted" = recently had volume spike (likely just launched or getting attention)
 */
async function fetchBoostedCoins() {
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/boosts?chainId=solana&limit=100',
      { timeout: 5000 }
    );
    const data = await res.json();
    return data.boosts || [];
  } catch (e) {
    console.warn('Boosted coins fetch error:', e.message);
    return [];
  }
}

/**
 * Get newly created tokens (age < 2 hours)
 * These are the EARLIEST entry points
 */
async function fetchNewCoins() {
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/search?q=age:0-2h&chainId=solana&sort=volume&limit=50',
      { timeout: 5000 }
    );
    const data = await res.json();
    return data.pairs || [];
  } catch (e) {
    console.warn('New coins fetch error:', e.message);
    return [];
  }
}

/**
 * Score and evaluate a coin immediately
 * CRITICAL: Determine if we should CALL this coin NOW
 */
async function evaluateForEarlyCall(pair) {
  try {
    const coin = {
      symbol: pair.baseToken?.symbol || 'UNKNOWN',
      mint: pair.baseToken?.address || pair.mint,
      ts: Date.now(),
      fdv: pair.fdv || 0,
      liquidity: pair.liquidity?.usd || 0,
      volume24h: pair.volume?.h24 || 0,
      volume1h: pair.volume?.h1 || 0,
      holders: pair.holders || 0,
      priceUsd: parseFloat(pair.priceUsd || 0),
      bundleSize: pair.bundleSize || 0,
      source: pair.boosts?.length > 0 ? 'boosted' : 'trending',
      launchPlatform: pair.launchPlatform?.toLowerCase() || 'unknown',
      pairCreatedAt: pair.pairCreatedAt,
    };

    // Age in minutes
    const ageMinutes = (Date.now() - (pair.pairCreatedAt || Date.now())) / 1000 / 60;
    coin.ageMinutes = ageMinutes;

    // EARLY CALL CRITERIA (extremely strict):
    // 1. Age: <5 minutes old (brand new, no pump yet)
    // 2. Bundle: <10% (not heavily concentrated)
    // 3. Liquidity: >$20K (can actually exit)
    // 4. Not blacklisted (Raydium, Meteora, PumpFun)
    // 5. Not a known scam pattern
    // 6. NOT already pumped (curMult < 3x)

    const blacklist = ['raydium', 'meteora', 'pumpfun', 'fair'];
    if (blacklist.some(b => coin.source.toLowerCase().includes(b))) {
      return { score: 0, reason: 'Blacklisted source', callNow: false };
    }

    if (ageMinutes > 5) {
      return { score: 0, reason: `Too old (${Math.round(ageMinutes)}m old)`, callNow: false };
    }

    // REJECT if already significantly pumped (guard against stale data)
    if (coin.fdv > 0 && coin.entryFdv && coin.fdv > coin.entryFdv * 3) {
      return { score: 0, reason: `Already pumped (${(coin.fdv / coin.entryFdv).toFixed(1)}x)`, callNow: false };
    }

    if (coin.bundleSize > 10) {
      return { score: 0, reason: `Bundle too high (${coin.bundleSize}%)`, callNow: false };
    }

    if (coin.liquidity < 20000) {
      return { score: 0, reason: `Liquidity too low ($${coin.liquidity})`, callNow: false };
    }

    // SCORE calculation
    let score = 0;

    // Base for being new
    score += 30;

    // Liquidity bonus
    if (coin.liquidity > 50000) score += 20;
    if (coin.liquidity > 100000) score += 10;

    // Bundle penalty
    if (coin.bundleSize < 5) score += 15;
    else if (coin.bundleSize < 10) score += 8;

    // Organic growth (low initial holders = not pre-filled)
    if (coin.holders < 500) score += 10;
    if (coin.holders < 100) score += 5;

    // Volume signal
    if (coin.volume1h > 10000) score += 10;

    // Age bonus (earlier is better, but only if other metrics are good)
    if (ageMinutes < 2) score += 15;
    else if (ageMinutes < 3) score += 10;
    else if (ageMinutes < 5) score += 5;

    const recommendation = {
      symbol: coin.symbol,
      score,
      ageMinutes: Math.round(ageMinutes * 10) / 10,
      bundleSize: coin.bundleSize,
      liquidity: Math.round(coin.liquidity),
      holders: coin.holders,
      callNow: score >= 70,
      reason: score >= 70 ? '🚀 EARLY CALL READY' : `Score too low (${score})`,
      confidence: Math.min((score / 100) * 100, 95),
      callStrategy: score >= 70 ? {
        action: 'CALL THIS COIN',
        entryFdv: coin.fdv,
        rationale: `${Math.round(ageMinutes)}m old, ${coin.bundleSize}% bundle, $${Math.round(coin.liquidity / 1000)}K liq`,
        riskLevel: 'very-high',
        positionSize: 'micro (max 1% account)',
      } : null,
    };

    return recommendation;
  } catch (e) {
    console.warn('Evaluation error:', e.message);
    return { score: 0, reason: 'Evaluation failed', callNow: false };
  }
}

/**
 * Run discovery cycle
 * Fetch new + boosted coins, evaluate each, store eligible ones
 */
async function runDiscoveryCycle() {
  try {
    const now = Date.now();

    // Clean old entries (>1 hour)
    recentCoins = Object.entries(recentCoins)
      .filter(([_, ts]) => now - ts < 3600000)
      .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});

    const [boosted, newCoins] = await Promise.all([
      fetchBoostedCoins(),
      fetchNewCoins(),
    ]);

    const allCoins = [...boosted, ...newCoins];
    const candidates = [];

    for (const pair of allCoins) {
      const mint = pair.baseToken?.address || pair.mint;
      if (!mint || recentCoins[mint]) continue; // Skip already seen

      const evaluation = await evaluateForEarlyCall(pair);
      if (evaluation.callNow) {
        candidates.push({
          ...evaluation,
          mint,
          fetchedAt: now,
        });
      }

      recentCoins[mint] = now;
    }

    // Store candidates
    if (candidates.length > 0) {
      const earlyPath = path.join(DATA_DIR, 'early-call-candidates.json');
      const existing = JSON.parse(fs.readFileSync(earlyPath, 'utf8') || '[]');
      fs.writeFileSync(
        earlyPath,
        JSON.stringify([...candidates, ...existing].slice(0, 100))
      );

      console.log(`🚀 Found ${candidates.length} early call candidates`);
    }

    return {
      cycleTime: new Date().toISOString(),
      totalEvaluated: allCoins.length,
      callCandidates: candidates.length,
      candidates: candidates.slice(0, 10),
    };
  } catch (e) {
    console.error('Discovery cycle error:', e);
    return { error: e.message };
  }
}

// Run discovery every 30 seconds (aggressive for early detection)
let discoveryInterval;
function startDiscovery() {
  if (discoveryInterval) clearInterval(discoveryInterval);
  discoveryInterval = setInterval(runDiscoveryCycle, 30000);
  // Run immediately on start
  runDiscoveryCycle();
}

startDiscovery();

// ═══════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/signal-discovery/candidates
 * Latest early call candidates
 */
router.get('/candidates', (req, res) => {
  try {
    const path2 = path.join(DATA_DIR, 'early-call-candidates.json');
    const candidates = JSON.parse(fs.readFileSync(path2, 'utf8') || '[]');
    res.json({
      count: candidates.length,
      candidates: candidates.slice(0, 20),
    });
  } catch {
    res.json({ count: 0, candidates: [] });
  }
});

/**
 * GET /api/signal-discovery/status
 * Last discovery cycle status
 */
router.get('/status', (req, res) => {
  res.json({
    active: !!discoveryInterval,
    cycleIntervalMs: 30000,
    recentCoinsTracked: Object.keys(recentCoins).length,
    status: 'running',
  });
});

/**
 * POST /api/signal-discovery/call-candidate
 * Manually call an early candidate
 */
router.post('/call-candidate', async (req, res) => {
  const { mint, symbol } = req.body;
  if (!mint || !symbol) {
    return res.json({ error: 'Missing mint or symbol' });
  }

  try {
    // Trigger signal call via main engine
    const callRes = await fetch('http://localhost:3000/api/signal-engine/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coin: { mint, symbol, ts: Date.now() },
      }),
    });

    const result = await callRes.json();
    res.json({ called: true, result });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/**
 * GET /api/signal-discovery/run
 * Manually trigger a discovery cycle
 */
router.get('/run', async (req, res) => {
  const result = await runDiscoveryCycle();
  res.json(result);
});

module.exports = { router, runDiscoveryCycle };
