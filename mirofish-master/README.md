# 🐟 MiroFish Master

Private master repo holding the improved **MiroFish terminal (v7.0 PRO)** and the **ZA signals bot (v2)** — both upgraded with the curated best of seven source repos. No clutter: every feature below had to earn its place.

## What's inside

| Path | What |
|---|---|
| `terminal/index.html` | MiroFish v7.0 PRO — single-file, zero-build terminal |
| `bot/` | ZA signals bot v2 — Node, zero dependencies (Node 18+ built-in fetch) |

## Best-of map (what was taken, from where)

| Feature | Taken from | Why |
|---|---|---|
| RSI / volume-spike / regression-divergence TA | `b-fg/nuatsbot` (`nuats_ta.py`) | The only real signal math in the source set; modernized to dependency-free JS (original used dead 2018 pandas APIs) |
| RugCheck safety gate + token card | `0xRefDev/gemtrack_bot` (`services/rugcheck.js`) | Score threshold, mint/freeze authority flags, top-holder concentration, GMGN links — translated to English, plain fetch |
| Telegram channel monitoring concept + multi-source price fetch | `gogonuk/memecoin-bot` | DexScreener-first price fetching adopted; group monitoring deliberately **not** taken (needs API keys, adds clutter) |
| Command palette (Ctrl+K) | `ErTasselli/OpenTerminal` (`CommandPalette.tsx`) | The single best "pro terminal" affordance; rebuilt in 60 lines of vanilla JS instead of Next.js |
| Signal ranking + digest broadcast discipline | `nlethetech/nepse-quant-terminal` (`signal_ranking.py`, `telegram_alerts.py`) | Strength-ranked digests, cooldown per market |
| Hard risk clamps wired around a signal engine | `NoFxAiOS/nofx` | The architecture idea (engine proposes, risk layer disposes) applied to the existing ZA engine |
| — | `waveterncleanse/robinhood-sniper-bot` | Empty repo (LICENSE only) — nothing to take |

## Terminal v7.0 PRO changes (vs TuFish v6)

- **DEX token images** — DexScreener `info.imageUrl` (+ CoinGecko `image` for majors) rendered as 22px rounded tokens with letter-badge fallback
- **Live sentiment** — real Fear & Greed from `api.alternative.me` (was `Math.random()`); per-category scores now derived from live 24h market data
- **Telegram wiring** — Settings → bot token + chat ID; manual digest send + AUTO mode (70%+ confidence, 30-min per-market cooldown)
- **Command palette** — Ctrl+K / ⌘K: panels, refresh, trade top signal, Monte Carlo, TG digest, theme, export
- **Pro badge** — v7.0 · PRO in the header
- **Real price chart** — Markets panel now has a 7-day chart (was initialized but never rendered); real CoinGecko sparkline data, synthetic only as fallback; click any market to chart it
- **Live RSI panel** — Portfolio's RSI chart computes Wilder RSI from real 7d sparkline data (was random)
- **Deterministic swarm** — all 7 agents now vote from live market factors (turnover for Whale, live Fear&Greed for Fearless, price position for Sage); randomness removed
- **Swarm consensus log** — real consensus snapshots persisted to `mf_swarm` every 30 min, rendered as the history bars (was random)
- **Solana adapter** — switched Jupiter→DexScreener: real 24h change + token images (change was `Math.random()`)
- **Alerts fixed** — market selector is now populated (was empty, so alerts could never be created); alerts store market IDs, not fragile indexes
- **Data-driven sentiment factor** — the per-market sentiment feeding signal confidence + the Sentinel agent is now derived from live 24h change + volume turnover (was the last `Math.random()` in the signal path)
- **Signal cards chart** — clicking a signal card jumps to Markets and charts it (was a dead toast)
- **Adaptive chart precision** — memecoin prices (0.00000x) render correctly instead of rounding to 0.0
- **Theme-aware charts** — main + RSI charts restyle on light/dark toggle (were hardcoded dark)
- **Sentiment panel** — hides sources disabled in Settings instead of showing random fallbacks

## Bot v2 changes (vs ZA-zerox-autotrader)

- `ta.js` — Wilder RSI-14, volume spikes, RSI/price divergence over 10/20/30/40 windows (≥3 confirmations), self-tested
- `rugcheck.js` — rugcheck.xyz gate before any memecoin call is broadcast
- `signals-bot.js` — live loop: Binance klines → TA → DexScreener memecoin scan → rugcheck gate → paper desk → ranked digest → Telegram/Discord
- `paper.js` — persistent paper desk trading the ZA strategy on live signals: 4% SL, trail arms at +12% ROI, exits 6% off the high-water mark (armed-state bug caught and fixed by self-test), $5/trade cap, $25/day cap, max 5 concurrent; P&L footer in every digest
- `engine.js` — original ZA strategy (4% SL / 12% trail / 6% gap / 2% size) with the risk config **actually wired**: 15% drawdown circuit breaker, $25 daily cap, $5 per-trade cap, 20-trade daily limit
- `npm test` — `node ta.js && node paper.js` self-tests; `npm run dry` for a no-keys dry cycle
- **Persistence + robustness** — signal cooldowns survive restarts (`signals-state.json`), Binance calls fall back to `data-api.binance.vision` on geo-block, batch price URLs properly encoded, DexScreener symbols normalized (`$WIF`/`Bonk` → `WIF`/`BONK`) so paper positions always mark, slippage applied on paper entries/exits

## Cross-links

- Original terminal: [IzzoSol/TuFish](https://github.com/IzzoSol/TuFish) (public)
- Original bot: [IzzoSol/ZA-zerox-autotrader](https://github.com/IzzoSol/ZA-zerox-autotrader) (private)
- Structure pattern: [IzzoSol/shaddai-gamedev-tools](https://github.com/IzzoSol/shaddai-gamedev-tools)

## Agent note

Built 2026-10-03. SHADDAI MCP / local agent ports (8000-8008) were offline, so the ZEROX (broadcast policy, risk economics), TURTLE (token-image + palette design), and NEXUS (module layout, breaker wiring) disciplines were applied in-session per `AGENT_SYSTEM_PROMPTS.md`. Re-run each agent review when the empire is back online.
