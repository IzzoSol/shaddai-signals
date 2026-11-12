# 🐟 MiroFish Income Engine

**The Yin & Yang of research and AI** — A Polymarket prediction market trading terminal with swarm intelligence, sentiment analysis, Kelly Criterion position sizing, auto-trading, and real Polymarket CLOB API integration.

## Features

### Trading Engine
- **Multi-Factor Signal Engine** — Scores markets on momentum, sentiment, volume, and price position
- **Kelly Criterion Sizing** — Optimal bet sizing based on edge probability
- **Auto-Trading Mode** — Automatically trades top signals every 15 seconds
- **Real Polymarket CLOB API** — Live order placement via Polymarket's CLOB API
- **Wallet Integration** — MetaMask / Phantom wallet connection
- **Simulated ↔ Real Toggle** — Switch between paper trading and live execution

### Swarm Intelligence
- **7 Voting Agents** — Momentum, Value, Sentinel, Volume, Whale, Fearless, Sage
- **Live Consensus Meter** — See real-time agreement levels
- **30-Day Accuracy Chart** — Track each agent's performance history
- **Agent Personality System** — Each agent has unique biases and strategies

### Analytics & Risk
- **Monte Carlo Simulator** — 1,000 simulations × 30 days to assess ruin risk
- **Value at Risk (VaR)** — 95% confidence VaR calculation
- **Sharpe Ratio** — Risk-adjusted return metric
- **Profit Factor** — Gross win / gross loss ratio
- **Max Drawdown Tracking** — Peak-to-trough analysis
- **Win Rate & ROI** — Real-time performance metrics

### Charting & Visuals
- **Price Chart** — 120-hour price history with Lightweight Charts
- **RSI Indicator** — Relative Strength Index overlay
- **Fear & Greed Index** — Gauge-based market sentiment indicator
- **Sentiment Heatmap** — 5-category sentiment breakdown
- **Strategy Breakdown** — Per-strategy P&L visualization

### Data Management
- **localStorage Persistence** — All data survives page reloads
- **JSON Export/Import** — Full data portability
- **90-Day Backtest Engine** — Simulate 200 trades instantly
- **Signal Alerts** — Price-triggered desktop notifications
- **Push Browser Notifications** — Real-time trade alerts

## Quick Start

Just open `index.html` in any modern browser. No server required.

```bash
# Clone the repo
git clone https://github.com/IzzoSol/TuFish.git

# Open in browser
cd TuFish
open index.html
```

## Configuration

### Polymarket API (for real trading)
1. Go to [Polymarket API Keys](https://polymarket.com/profile/api)
2. Generate an API key, secret, and passphrase
3. Enter them in the Settings panel
4. Connect MetaMask wallet
5. Toggle to "🔴 Real Trading" mode

### Trading Settings
- **Interval** — How often to refresh signals (seconds)
- **Capital** — Starting balance for simulated trading
- **Agent Mode** — Auto or manual swarm voting
- **Push Notifications** — Browser notifications for trade alerts
- **Theme** — Dark/Light mode toggle

## Architecture

Single-file HTML application with no dependencies beyond:
- `lightweight-charts` (CDN) — Charting library
- `ethers.js` (CDN, optional) — Web3 wallet connection
- Polymarket CLOB API — Live market data and order execution

## Keyboard Shortcuts
- Click **AUTO-TRADE** to start automated trading
- Click **📊 Run Monte Carlo** for risk assessment
- Click **🔔** to enable push notifications
- Click **🌙** to toggle dark/light theme

## Storage
All data stored in browser localStorage under keys:
- `mf_portfolio` — Trading portfolio and history
- `mf_alerts` — Price/signal alerts
- `mf_settings` — User preferences
- `mf_chat` — Chat history
- `mf_swarm` — Swarm agent data
- `mf_sigstats` — Signal statistics

## License
MIT
