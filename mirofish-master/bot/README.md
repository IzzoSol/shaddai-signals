# ZA Signals Bot v2

Zero-dependency Node bot (Node 18+). Live TA on Binance pairs + memecoin scan on DexScreener, rugcheck-gated, broadcast to Telegram and/or Discord, with a persistent paper desk that trades the ZA strategy (4% SL / 12% arm / 6% trail) on its own signals.

## Run

```
npm run dry                           # single cycle, console only — no keys needed
set TELEGRAM_BOT_TOKEN=123:abc      # optional — omit for dry-run
set TELEGRAM_CHAT_ID=-100123        # optional
npm start                            # live loop, one cycle every 15 min
npm run once                         # single cycle, sends if configured
npm test                             # runs ta.js + paper.js self-tests
npm run engine                       # ZA statistical simulation
```

## Modules

| File | Role |
|---|---|
| `config.js` | All knobs: strategy, risk, TA thresholds, watchlists, TG/Discord |
| `ta.js` | RSI-14, volume spikes, regression divergence (10/20/30/40 windows, 3+ confirmations). Self-tested |
| `rugcheck.js` | rugcheck.xyz gate (score, authorities, top-holder %) + plain-text token card |
| `broadcast.js` | Telegram Bot API + Discord webhook senders |
| `signals-bot.js` | Loop: klines → TA → memes → rugcheck → paper desk → digest → broadcast. 6h per-signal cooldown, top 8 per digest |
| `paper.js` | Paper desk: opens longs from top buy signals (2% size, $5 cap, $25/day), marks each cycle at live prices, exits on 4% SL or 12%-armed/6%-gap trail. Persists to `paper-state.json`; P&L rides in every digest footer. Rule self-tested |
| `engine.js` | ZA paper engine with wired circuit breaker (15% drawdown), $25/day, $5/trade, 20 trades/day. Statistical simulation |

## Signal policy

- Strength 0-100; only ≥60 broadcast (`signalMinStrength`)
- Meme calls need $20k+ liquidity and either 1.8x 6h-volume pace or ±8% 24h move, then must pass rugcheck — failures surface as ⚠️ AVOID with flags
- Binance TA: RSI overbought/oversold, volume spikes >5x average, multi-window divergence
- Paper desk: max 5 concurrent, one per symbol, sizes off live capital, closed trades journaled
