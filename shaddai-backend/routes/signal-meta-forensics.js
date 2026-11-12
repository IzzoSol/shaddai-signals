/**
 * ZEROX Meta Forensics
 * Deep analysis: thesis, socials, meta trends, psychology, naming patterns
 * What's the NARRATIVE behind winners vs losers?
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

/**
 * Current meta themes (user can add/update)
 * Track what's HOT and WHY
 */
const META_THEMES = {
  'cat': { emoji: '🐱', description: 'Cat-themed coins (BONK vibes)', examples: ['DOGE', 'SHIBA', 'PURR'] },
  'rwa': { emoji: '🏛️', description: 'Real-world assets (stocks, gold, commodities)', examples: ['STONK', 'CETS', 'DEGS'] },
  'ai': { emoji: '🤖', description: 'AI-related tokens', examples: ['AIOSS', 'GROK'] },
  'defi': { emoji: '💰', description: 'DeFi/lending protocols', examples: ['RAY', 'JUP'] },
  'gaming': { emoji: '🎮', description: 'Gaming/P2E tokens', examples: ['COPE', 'MUMU'] },
  'meme': { emoji: '😂', description: 'Pure meme/no utility', examples: ['PEPE', 'BRETT'] },
  'utility': { emoji: '⚙️', description: 'Real utility/infrastructure', examples: ['SOL', 'RAY'] },
  'l2-scaling': { emoji: '⚡', description: 'Layer 2 / scaling solutions', examples: [] },
};

/**
 * Naming pattern analysis
 * What kinds of names WIN?
 */
function analyzeNamingPatterns(coins) {
  const patterns = {
    oneWord: [],
    twoWord: [],
    acronym: [],
    animalThemed: [],
    numberBased: [],
    abbreviation: [],
    allCaps: [],
  };

  coins.forEach(c => {
    const name = c.symbol || '';
    const words = name.split(/[\s\-_]/);

    if (words.length === 1) patterns.oneWord.push(name);
    if (words.length === 2) patterns.twoWord.push(name);
    if (/^[A-Z]{2,}$/.test(name)) patterns.acronym.push(name);
    if (/[0-9]/.test(name)) patterns.numberBased.push(name);
    if (name.length <= 4) patterns.abbreviation.push(name);
    if (name === name.toUpperCase()) patterns.allCaps.push(name);

    // Animal detection
    const animalWords = ['doge', 'shib', 'cat', 'dog', 'bull', 'bear', 'penguin', 'ape', 'monkey', 'panda'];
    if (animalWords.some(a => name.toLowerCase().includes(a))) {
      patterns.animalThemed.push(name);
    }
  });

  return {
    patterns,
    insights: {
      mostCommon: Object.entries(patterns)
        .map(([type, names]) => ({ type, count: names.length, examples: names.slice(0, 3) }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

/**
 * Detect meta theme from coin name/symbol
 */
function detectMetaTheme(symbol, thesis = '') {
  const combined = `${symbol} ${thesis}`.toLowerCase();

  for (const [themeKey, themeDef] of Object.entries(META_THEMES)) {
    const keywords = themeDef.examples.map(e => e.toLowerCase());
    for (const kw of keywords) {
      if (combined.includes(kw)) return themeKey;
    }

    // Additional keyword detection
    if (themeKey === 'cat' && (combined.includes('cat') || combined.includes('meow'))) return 'cat';
    if (themeKey === 'rwa' && (combined.includes('stock') || combined.includes('gold') || combined.includes('real'))) return 'rwa';
    if (themeKey === 'ai' && (combined.includes('ai') || combined.includes('neural'))) return 'ai';
    if (themeKey === 'defi' && (combined.includes('defi') || combined.includes('swap'))) return 'defi';
    if (themeKey === 'gaming' && (combined.includes('game') || combined.includes('play'))) return 'gaming';
  }

  return 'unknown';
}

/**
 * Analyze psychological appeal of coin names/thesis
 */
function analyzePsychology(coins) {
  const psychology = {
    emotionalAppeals: {},
    trustSignals: {},
    urgencySignals: {},
    communitySignals: {},
  };

  coins.forEach(c => {
    const symbol = c.symbol || '';
    const thesis = c.thesis || '';
    const combined = `${symbol} ${thesis}`.toLowerCase();

    // Emotional appeal
    if (/moon|rocket|lambo|rich|moon|to the moon/i.test(combined)) {
      psychology.emotionalAppeals.moonShot = (psychology.emotionalAppeals.moonShot || 0) + 1;
    }
    if (/safe|secure|protect|guard/i.test(combined)) {
      psychology.emotionalAppeals.security = (psychology.emotionalAppeals.security || 0) + 1;
    }
    if (/community|together|we|our/i.test(combined)) {
      psychology.communitySignals.inclusive = (psychology.communitySignals.inclusive || 0) + 1;
    }

    // Trust signals
    if (c.audited || /audit|verified|certified/i.test(combined)) {
      psychology.trustSignals.audited = (psychology.trustSignals.audited || 0) + 1;
    }
    if (c.locked || /lock|safe/i.test(combined)) {
      psychology.trustSignals.liquLocked = (psychology.trustSignals.liquLocked || 0) + 1;
    }

    // Urgency
    if (c.bundleSize && c.bundleSize < 10) {
      psychology.urgencySignals.smallBundle = (psychology.urgencySignals.smallBundle || 0) + 1;
    }
  });

  return psychology;
}

/**
 * Build a thesis database from all calls
 */
function buildThesisDatabase() {
  try {
    const calls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tg-calls.json'), 'utf8') || '[]');

    // Categorize by outcome
    const winners = calls.filter(c => c.peakMult && c.peakMult >= 3);
    const losers = calls.filter(c => c.peakMult && c.peakMult < 1.5);

    // Group by meta theme
    const winnersByTheme = {};
    const losersByTheme = {};

    winners.forEach(c => {
      const theme = detectMetaTheme(c.symbol || '', c.thesis || '');
      if (!winnersByTheme[theme]) winnersByTheme[theme] = [];
      winnersByTheme[theme].push(c);
    });

    losers.forEach(c => {
      const theme = detectMetaTheme(c.symbol || '', c.thesis || '');
      if (!losersByTheme[theme]) losersByTheme[theme] = [];
      losersByTheme[theme].push(c);
    });

    // Analyze naming
    const winnerNaming = analyzeNamingPatterns(winners);
    const loserNaming = analyzeNamingPatterns(losers);

    // Analyze psychology
    const winnerPsych = analyzePsychology(winners);
    const loserPsych = analyzePsychology(losers);

    return {
      summary: {
        totalAnalyzed: calls.length,
        winners: winners.length,
        losers: losers.length,
      },

      themeAnalysis: {
        metaThemes: META_THEMES,
        winnersByTheme: Object.entries(winnersByTheme).map(([theme, coins]) => ({
          theme,
          count: coins.length,
          avgMult: (coins.reduce((s, c) => s + c.peakMult, 0) / coins.length).toFixed(2),
          examples: coins.slice(0, 3).map(c => ({ symbol: c.symbol, mult: c.peakMult, entryFdv: c.entryFdv })),
        })),
        losersByTheme: Object.entries(losersByTheme).map(([theme, coins]) => ({
          theme,
          count: coins.length,
          avgMult: (coins.reduce((s, c) => s + c.peakMult, 0) / coins.length).toFixed(2),
          examples: coins.slice(0, 3).map(c => ({ symbol: c.symbol, mult: c.peakMult, entryFdv: c.entryFdv })),
        })),
      },

      namingAnalysis: {
        winners: winnerNaming,
        losers: loserNaming,
        insight: 'Do winners have shorter names? Are they more animal-themed? More acronymic?',
      },

      psychologyAnalysis: {
        winners: winnerPsych,
        losers: loserPsych,
        insight: 'What emotional/trust appeals work? Which psychological triggers drive wins?',
      },

      currentMetaTrends: {
        hotThemes: Object.entries(winnersByTheme)
          .map(([theme, coins]) => ({ theme, count: coins.length, winRate: ((coins.length / (winnersByTheme[theme]?.length || 1)) * 100).toFixed(0) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
        coldThemes: Object.entries(losersByTheme)
          .map(([theme, coins]) => ({ theme, count: coins.length }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3),
      },

      actionItems: [
        '🔍 Scan Twitter/Discord for emerging thesis patterns',
        '📊 Track meta trend velocity (what\'s accelerating vs declining)',
        '🎨 Monitor naming conventions in current winners',
        '💬 Analyze sentiment in winning coin communities',
        '🧠 Build psychological appeal scoring for new coins',
      ],
    };
  } catch (e) {
    console.error('Thesis database error:', e);
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/signal-meta-forensics
 * Full meta forensics with thesis, themes, psychology
 */
router.get('/', (req, res) => {
  try {
    const analysis = buildThesisDatabase();
    if (analysis.error) {
      return res.json({
        summary: { totalAnalyzed: 0, winners: 0, losers: 0 },
        status: 'no-data-yet',
        actionItems: ['Waiting for signal calls to analyze...'],
      });
    }
    res.json(analysis);
  } catch (e) {
    res.json({
      summary: { totalAnalyzed: 0, winners: 0, losers: 0 },
      status: 'no-data-yet',
      error: e.message,
    });
  }
});

/**
 * GET /api/signal-meta-forensics/themes
 * Current meta themes and current trends
 */
router.get('/themes', (req, res) => {
  const analysis = buildThesisDatabase();
  res.json({
    themes: META_THEMES,
    currentTrends: analysis.currentMetaTrends || { hotThemes: [], coldThemes: [] },
    winnersByTheme: analysis.themeAnalysis?.winnersByTheme || [],
  });
});

/**
 * GET /api/signal-meta-forensics/naming
 * Naming pattern analysis
 */
router.get('/naming', (req, res) => {
  const analysis = buildThesisDatabase();
  res.json({
    naming: analysis.namingAnalysis,
    insight: 'What naming patterns correlate with wins vs losses?',
  });
});

/**
 * GET /api/signal-meta-forensics/psychology
 * Psychological appeal analysis
 */
router.get('/psychology', (req, res) => {
  const analysis = buildThesisDatabase();
  res.json({
    psychology: analysis.psychologyAnalysis,
    insight: 'What emotional/trust appeals drive trading decisions?',
  });
});

/**
 * POST /api/signal-meta-forensics/add-theme
 * Add a new meta theme (admin only)
 */
router.post('/add-theme', (req, res) => {
  const { name, description, examples } = req.body;
  if (!name || !description) {
    return res.json({ error: 'Missing name or description' });
  }

  META_THEMES[name.toLowerCase()] = {
    emoji: '🔹',
    description,
    examples: examples || [],
  };

  res.json({
    added: name,
    themes: META_THEMES,
  });
});

module.exports = router;
