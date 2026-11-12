module.exports = {
  strategy: {
    stopLossPct: 4,
    trailActivatePct: 12,
    trailGapPct: 6,
    positionSizePct: 2,
    initialCapital: 200,
    maxPerTradeUsd: 5,
    simulateSlippage: 0.003,
    medianWinnerRoi: 48.7
  },
  risk: {
    maxDrawdownPct: 15,
    dailyBudgetUsd: 25,
    maxDailyTrades: 20,
    circuitBreakerLossPct: 10
  },
  ta: {
    rsiOverbought: 70,
    rsiOversold: 30,
    volumeGrowthThreshold: 5,
    divergenceConfirmations: 3
  },
  watch: {
    binance: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT'],
    interval: '1h',
    limit: 120
  },
  memes: [
    { s: 'BONK', n: 'Bonk', a: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { s: 'WIF', n: 'DogWifHat', a: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
    { s: 'POPCAT', n: 'Popcat', a: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
    { s: 'MEW', n: 'cat in a dogs world', a: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5' },
    { s: 'SAMO', n: 'Samoyed Coin', a: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' },
    { s: 'MYRO', n: 'Myro', a: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4' },
    { s: 'PENG', n: 'Peng', a: 'PENGuBnHr3UVfMi6T84B3r4qKpYFqh9hEw2JkfPfuVr' },
    { s: 'BOME', n: 'BOOK OF MEME', a: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82' },
    { s: 'SILLY', n: 'Silly Dragon', a: '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3RyouHeoBruuR' },
    { s: 'MICHI', n: 'Michi', a: '5B3Xx1RmXxJ6x3STgKvLTG6sPjjfhPL1Jd3yDbQWz3Pp' }
  ],
  rugcheck: { maxScore: 2500, maxTopHolderPct: 35 },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || ''
  },
  discord: { webhook: process.env.DISCORD_WEBHOOK_URL || '' },
  loopMinutes: 15,
  signalMinStrength: 60,
  digestMaxSignals: 8
};
