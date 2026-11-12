/**
 * ZEROX Signal Engine v2
 * Meta-based coin categorization + real-time calling
 * OGs, Most Held, Whale Accumulation, Boosted, Top DEX
 *
 * Problem: Previous version was calling garbage (Raydium launches, 2% win rate)
 * Solution: Strict meta filtering + proper entry timing detection
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { trackCoin, getMultiplierBaseline } = require('./coin-tracker');

const DATA_DIR = path.join(__dirname, '../data');

// ═══════════════════════════════════════════════════════════
// COIN METADATA SYSTEM
// ═══════════════════════════════════════════════════════════

// OG coins that have proven track records (manually curated)
const OG_COINS = {
  'Troll': { mint: '3ogista...', created: '2024-01', category: 'og', score: 100 },
  'Buttcoin': { mint: 'butter...', created: '2024-02', category: 'og', score: 95 },
  'Motion': { mint: 'motion...', created: '2024-03', category: 'og', score: 90 },
  'UFD': { mint: 'ufd...', created: '2024-04', category: 'og', score: 92 },
  'KNIGHTCORE': { mint: 'knight...', created: '2024-05', category: 'og', score: 88 },
};

// Blacklist: coins we NEVER call
const BLACKLIST = [
  'raydium', // Raydium automated launches = 95% scams
  'meteora', // Meteora launches = same
  'pumpfun', // PumpFun = memecoin casino
  'fair', // Fair launch bots = instant rugs
  'new_listing', // Brand new, unvetted
];

// Categories from DexScreener + manual tracking
const COIN_CATEGORIES = {
  'og': {
    name: 'OG Coins',
    description: 'Proven winners: Troll, Buttcoin, Motion, UFD, etc.',
    scoreBonus: 30,
    minHolders: 500,
    minAge: '2024-01', // Created after Jan 2024
  },
  'most_held': {
    name: 'Most Held',
    description: 'Top 100 by holder count (>50k holders)',
    scoreBonus: 20,
    minHolders: 50000,
  },
  'whale_accumulation': {
    name: 'Whale Accumulation',
    description: 'Top tracked wallets buying >$100k',
    scoreBonus: 25,
    minWalletSize: 100000,
    trackingThreshold: 3, // >=3 tracked wallets holding
  },
  'boosted': {
    name: 'Boosted',
    description: 'Volume spike >200% 24h',
    scoreBonus: 20,
    minVolumeSpike: 2.0,
  },
  'top_25_dex': {
    name: 'Top 25 DEX',
    description: 'Highest liquidity on DEX',
    scoreBonus: 15,
    minLiquidity: 500000,
  },
  'emerging': {
    name: 'Emerging',
    description: 'Early stage, good metrics',
    scoreBonus: 10,
    minHolders: 100,
  },
};

// ═══════════════════════════════════════════════════════════
// ENTRY TIMING DETECTION
// ═══════════════════════════════════════════════════════════

/**
 * Detect best entry timing for a coin
 * Returns: 'early' | 'mid' | 'late' | 'miss'
 */
function detectEntryTiming(coin) {
  const now = Date.now();
  const ageHours = (now - coin.ts) / (1000 * 60 * 60);
  const holderGrowth = coin.holders / (coin.initialHolders || 1);
  const volumeGrowth = coin.volume24h / (coin.volume1h || 1);

  // Early: <2 hours old, <5x holder growth, <3x volume
  if (ageHours < 2 && holderGrowth < 5 && volumeGrowth < 3) {
    return { timing: 'early', confidence: 0.7, reason: 'Young, organic growth' };
  }

  // Mid: 2-6 hours, 3-20x holder growth, 2-10x volume
  if (ageHours >= 2 && ageHours < 6 && holderGrowth >= 3 && holderGrowth <= 20 && volumeGrowth >= 2 && volumeGrowth <= 10) {
    return { timing: 'mid', confidence: 0.85, reason: 'Confirmed momentum' };
  }

  // Late: >6 hours, still growing
  if (ageHours >= 6 && holderGrowth > 10) {
    return { timing: 'late', confidence: 0.6, reason: 'Late entry, high risk' };
  }

  return { timing: 'miss', confidence: 0, reason: 'Not ideal timing' };
}

// ═══════════════════════════════════════════════════════════
// SCORING SYSTEM v2 (STRICT)
// ═══════════════════════════════════════════════════════════

function scoreSignalV2(coin) {
  let score = 0;

  // STEP 1: Check blacklist (instant fail)
  const source = (coin.source || '').toLowerCase();
  for (const banned of BLACKLIST) {
    if (source.includes(banned)) return { score: 0, reason: `Blacklisted source: ${banned}` };
  }

  // STEP 2: Category bonus
  let categoryMatch = null;
  for (const [catKey, catDef] of Object.entries(COIN_CATEGORIES)) {
    if (coin.category === catKey) {
      score += catDef.scoreBonus;
      categoryMatch = catKey;
      break;
    }
  }

  // OG coin bonus
  if (OG_COINS[coin.symbol]) {
    score += 25;
    categoryMatch = 'og';
  }

  // STEP 3: Fundamental metrics
  if (coin.holders && coin.holders > 1000) score += 15; // Healthy holder count
  if (coin.liquidity && coin.liquidity > 100000) score += 12; // Good liquidity
  if (coin.verified) score += 10; // Verified/safe

  // STEP 4: Momentum (but penalize too-early)
  const timing = detectEntryTiming(coin);
  if (timing.timing === 'mid') {
    score += 20; // Confirmed momentum
  } else if (timing.timing === 'early') {
    score += 8; // Risky but earlier = bigger gains
  } else if (timing.timing === 'late') {
    score += 0; // Too late, usually a miss
  } else {
    return { score: 0, reason: 'Bad entry timing' };
  }

  // STEP 5: Risk penalty (Raydium/Meteora launches = -50)
  if (coin.launchPlatform === 'raydium' || coin.launchPlatform === 'meteora') {
    score -= 40; // Heavy penalty
  }

  // Final: Must be >= 70 to call
  if (score < 70) {
    return { score, reason: `Score too low: ${score}` };
  }

  return {
    score: Math.min(score, 100),
    timing: timing.timing,
    confidence: timing.confidence,
    category: categoryMatch,
    reason: 'CALL THIS COIN',
  };
}

// ═══════════════════════════════════════════════════════════
// SIGNAL CALLING (ACTUAL REAL-TIME)
// ═══════════════════════════════════════════════════════════

/**
 * Call a signal in real-time
 * Send to: TG bot + Dashboard + Notify user
 * CRITICAL FIX: Calculate REAL multipliers from live DexScreener data
 */
async function callSignal(coin, evaluation) {
  if (evaluation.score < 70) {
    console.log(`❌ Skipped ${coin.symbol}: ${evaluation.reason}`);
    return { called: false, reason: evaluation.reason };
  }

  try {
    console.log(`🔥 CALLING ${coin.symbol} (score: ${evaluation.score})`);

    // CRITICAL: Fetch LIVE DexScreener data
    let currentFdv = coin.fdv || 0;
    let currentPrice = coin.priceUsd || 0;
    let multipliers = { entryFdv: 0, currentFdv: 0, curMult: 1, peakMult: 1 };

    if (coin.mint) {
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${coin.mint}`, { timeout: 5000 });
        const dexData = await dexRes.json();
        if (dexData.pairs && dexData.pairs.length > 0) {
          const pair = dexData.pairs[0];
          currentPrice = parseFloat(pair.priceUsd || 0);
          currentFdv = pair.fdv || 0;

          // Track this coin and get REAL multiplier baseline
          trackCoin(coin.mint, coin.symbol, currentFdv);
          multipliers = getMultiplierBaseline(coin.mint, currentFdv);
        }
      } catch (e) {
        console.warn(`Could not fetch DexScreener for ${coin.symbol}:`, e.message);
      }
    }

    // ⛔ CRITICAL GUARDS: REJECT coins that can't run much further
    // Guard 1: If already 5x+ from when we first saw it
    if (multipliers.curMult > 5) {
      console.log(`⛔ REJECTED ${coin.symbol}: Already ${multipliers.curMult}x since discovery`);
      return {
        called: false,
        symbol: coin.symbol,
        reason: `Already ${multipliers.curMult}x - no room left to run`,
        multiplier: multipliers.curMult,
      };
    }

    // Guard 2: If current FDV is too high (>$50M = already established, not a trade)
    const fdvThresholdM = 50; // Max FDV in millions to call
    const fdvThresholdUsd = fdvThresholdM * 1000000;
    if (currentFdv > fdvThresholdUsd) {
      console.log(`⛔ REJECTED ${coin.symbol}: FDV too high ($${(currentFdv/1000000).toFixed(1)}M > $${fdvThresholdM}M limit)`);
      return {
        called: false,
        symbol: coin.symbol,
        reason: `FDV $${(currentFdv/1000000).toFixed(1)}M - already too established, limited upside`,
        fdv: currentFdv,
      };
    }

    // CRITICAL: Use ENTRY PRICE (at signal call time), not current price, for TP targets
    // This ensures traders enter at the EXACT price shown in the signal
    const entryPrice = currentPrice; // This IS the price when we call the signal

    // Calculate TP targets from ENTRY price (not current)
    const tp1Price = entryPrice * 1.5;   // 1.5x = 50% gain
    const tp2Price = entryPrice * 3;     // 3x = 200% gain
    const tp3Price = entryPrice * 5;     // 5x = 400% gain
    const slPrice = entryPrice * 0.85;   // 15% stop loss

    const tp1Gain = ((tp1Price / entryPrice - 1) * 100).toFixed(0);
    const tp2Gain = ((tp2Price / entryPrice - 1) * 100).toFixed(0);
    const tp3Gain = ((tp3Price / entryPrice - 1) * 100).toFixed(0);

    // 1. Build Telegram message with CORRECT entry/exit (calculated from entry price)
    let tgMsg = `
🔥 *ZEROX SIGNAL* 🔥
*${coin.symbol}* ${curMult > 1 ? `📈 ${curMult}x` : ''}
Score: \`${evaluation.score}\`
Entry: ${evaluation.timing}
Category: ${evaluation.category}

Entry FDV: $${Math.round(entryFdv / 1000)}K
Current FDV: $${Math.round(currentFdv / 1000)}K
Multiplier: ${curMult}x

Holders: ${coin.holders?.toLocaleString() || '—'}
Liquidity: $${(coin.liquidity / 1000 || 0).toFixed(0)}K
Volume 24h: $${(coin.volume24h / 1000 || 0).toFixed(0)}K

📍 *ENTRY PRICE*
\`$${entryPrice.toFixed(8)}\`

🎯 *TAKE PROFIT TARGETS*
• 1TP (1.5x): \`$${tp1Price.toFixed(8)}\` (+${tp1Gain}%)
• 2TP (3x): \`$${tp2Price.toFixed(8)}\` (+${tp2Gain}%)
• 3TP (5x): \`$${tp3Price.toFixed(8)}\` (+${tp3Gain}%)

🛑 *STOP LOSS*
\`$${slPrice.toFixed(8)}\` (-15%)

⚖️ *RISK/REWARD*: 1:3 (risk $0.01 to make $0.03)
`;

    tgMsg += `
📊 View in ZEROX Dashboard
🔗 ${coin.mint ? `https://dexscreener.com/solana/${coin.mint}` : '#'}
`;

    await fetch('http://localhost:3000/api/social/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'telegram',
        content: tgMsg,
      }),
    }).catch(() => {});

    // 2. Store call in database with REAL multipliers
    const calls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '[]');
    calls.unshift({
      symbol: coin.symbol,
      score: evaluation.score,
      timing: evaluation.timing,
      category: evaluation.category,
      ts: Date.now(),
      mint: coin.mint,
      holders: coin.holders,
      liquidity: coin.liquidity,
      bundleSize: coin.bundleSize || 0,
      // CRITICAL: Real multipliers from coin tracker baseline
      entryFdv: multipliers.entryFdv,
      currentFdv: multipliers.currentFdv,
      curMult: multipliers.curMult,
      peakMult: multipliers.peakMult,
      riskTier: evaluation.score > 85 ? 'safe' : evaluation.timing === 'early' ? 'risky' : 'medium',
      source: coin.source,
      // Store levels for later reference
      entryPrice: currentPrice,
      exitTargets: levelData ? levelData.tpTargets : null,
      stopLoss: levelData ? levelData.stopLoss : null,
    });

    fs.writeFileSync(path.join(DATA_DIR, 'tg-calls.json'), JSON.stringify(calls.slice(0, 200)));

    return {
      called: true,
      symbol: coin.symbol,
      score: evaluation.score,
      multiplier: curMult,
      entryFdv: Math.round(entryFdv / 1000),
      currentFdv: Math.round(currentFdv / 1000),
      tgSent: true,
      levelsIncluded: levelData && !levelData.error,
    };
  } catch (e) {
    console.error('Signal call error:', e);
    return { called: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/signal-engine/evaluate
 * Evaluate coin and call if it meets criteria
 */
router.post('/evaluate', async (req, res) => {
  try {
    const { coin } = req.body;
    if (!coin || !coin.symbol) {
      return res.json({ error: 'Missing coin data' });
    }

    const evaluation = scoreSignalV2(coin);
    const result = await callSignal(coin, evaluation);

    res.json({
      symbol: coin.symbol,
      evaluation,
      result,
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/signal-engine/categories
 * Get all coin categories
 */
router.get('/categories', (req, res) => {
  res.json({
    categories: COIN_CATEGORIES,
    ogCoins: OG_COINS,
    blacklist: BLACKLIST,
  });
});

/**
 * GET /api/signal-engine/recent-calls
 * Recent signals that were actually called
 */
router.get('/recent-calls', (req, res) => {
  try {
    const calls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '[]');
    res.json({
      totalCalls: calls.length,
      recent: calls.slice(0, 20),
      avgScore: (calls.reduce((s, c) => s + c.score, 0) / calls.length || 0).toFixed(1),
    });
  } catch {
    res.json({ totalCalls: 0, recent: [], avgScore: 0 });
  }
});

/**
 * GET /api/signal-engine/category-coins
 * Get coins by category (stationary list)
 */
router.get('/category-coins', async (req, res) => {
  const { category } = req.query;

  // Mock: In production, would query DexScreener + tracked wallets
  const categoryCoins = {
    'og': [
      { symbol: 'Troll', holders: 125000, liquidity: 2500000, score: 92 },
      { symbol: 'Buttcoin', holders: 89000, liquidity: 1850000, score: 88 },
      { symbol: 'Motion', holders: 76000, liquidity: 1620000, score: 85 },
      { symbol: 'UFD', holders: 92000, liquidity: 1950000, score: 89 },
      { symbol: 'KNIGHTCORE', holders: 71000, liquidity: 1500000, score: 84 },
    ],
    'most_held': [
      { symbol: 'SOL', holders: 18500000, liquidity: 250000000, score: 99 },
      { symbol: 'USDC', holders: 12000000, liquidity: 180000000, score: 98 },
      { symbol: 'BONK', holders: 8500000, liquidity: 95000000, score: 92 },
    ],
    'whale_accumulation': [
      { symbol: 'Magic Eden token', holders: 45000, tracked: 12, score: 87 },
      { symbol: 'Phantom token', holders: 52000, tracked: 15, score: 89 },
    ],
    'boosted': [
      { symbol: 'JTO', volume24h: 850000000, spike: 3.2, score: 91 },
      { symbol: 'COPE', volume24h: 120000000, spike: 2.8, score: 84 },
    ],
    'top_25_dex': [
      { symbol: 'COPE', liquidity: 125000000, score: 88 },
      { symbol: 'JTO', liquidity: 98000000, score: 87 },
      { symbol: 'BONK', liquidity: 95000000, score: 86 },
    ],
  };

  res.json({
    category,
    coins: categoryCoins[category] || [],
    updated: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════
// BACKGROUND: Update peak multipliers for all recent calls
// ═══════════════════════════════════════════════════════════

/**
 * Periodically update peakMult for all recent calls
 * Ensures we're tracking the actual highest price each coin reached
 */
async function updatePeakMultipliers() {
  try {
    const callsPath = path.join(DATA_DIR, 'tg-calls.json');
    const calls = JSON.parse(fs.readFileSync(callsPath, 'utf8') || '[]');

    // Only update recent calls (last 50)
    const recentCalls = calls.slice(0, 50);
    let updated = false;

    for (const call of recentCalls) {
      if (!call.mint || !call.entryFdv || call.entryFdv === 0) continue;

      try {
        // Fetch current price from DexScreener
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${call.mint}`, { timeout: 3000 });
        const dexData = await dexRes.json();

        if (dexData.pairs && dexData.pairs.length > 0) {
          const pair = dexData.pairs[0];
          const currentFdv = pair.fdv || 0;

          if (currentFdv > 0) {
            const currentMult = parseFloat((currentFdv / call.entryFdv).toFixed(2));
            // Update peakMult only if current is higher
            if (currentMult > (call.peakMult || 1)) {
              call.peakMult = currentMult;
              call.currentFdv = currentFdv;
              updated = true;
            }
          }
        }
      } catch (e) {
        // Silently skip if DexScreener fails
      }
    }

    if (updated) {
      fs.writeFileSync(callsPath, JSON.stringify(calls));
    }
  } catch (e) {
    console.warn('Peak multiplier update error:', e.message);
  }
}

// Run every 30 seconds
setInterval(updatePeakMultipliers, 30000);

module.exports = router;
