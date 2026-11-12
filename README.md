# SHADDAI Signals — Master Repo

**The canonical Telegram signals bot + trading ecosystem for SHADDAI.**

Sends real-time crypto signals to the public Telegram channel [@ShaddaiSignals](https://t.me/ShaddaiSignals), tracks PnL, manages wallets, and drives the ZEROX auto-trader paper-trading loop.

## Repository

**GitHub:** https://github.com/IzzoSol/shaddai-signals (public)
**Live demo:** https://shaddai-g81x.onrender.com

---

## What's Inside

### Telegram Bot (signals + commands)
- `telegram-bot.js` — main bot entry (commands, routing, chat handling)
- `telegram-core.js` — core Telegram API wrappers (sendMessage, sendPhoto, sendAudio, chat management)
- `telegram-signals.js` — **signal broadcaster**: polls DEX pairs every 5 min, posts to @ShaddaiSignals channel
- `telegram-news.js` — news feed + market pulse
- `telegram-pnl.js` — PnL tracking, call recording, win/loss stats
- `telegram-wallets.js` — wallet management, balance checks
- `telegram-routes.js` — HTTP routes (webhook, health)
- `TELEGRAM.html` — web dashboard for the bot

### Supporting Modules
- `pipeline.js` — candidate discovery + filtering pipeline
- `providers.js` — market data providers (GeckoTerminal, DexScreener, etc.)
- `token-db.js` — token call database (SQLite/JSON)
- `hf-keys.js` / `lib/hf-keys.js` — Hugging Face API key rotation
- `lib/conviction.js` — conviction scoring engine
- `lib/music-gen-node.js` — music generation (for bot audio)
- `lib/pnl-images.js` — PnL chart image generation

### SHADDAI Backend (MCP tools + signal routes)
- `shaddai-backend/mcp-client.js` — MCP client for agent communication
- `shaddai-backend/mcp-server-rag.js` — RAG-powered MCP server
- `shaddai-backend/build-mcp-package.js` — MCP package builder
- `shaddai-backend/routes/signal-*.js` — signal analysis, discovery, scoring, forensics, levels, meta-forensics
- `shaddai-backend/routes/pro-signals.js` — pro-tier signals
- `shaddai-backend/tools-defi.js` — DeFi tools
- `shaddai-backend/tools-markets.js` — market data tools
- `shaddai-backend/tools-news.js` — news tools
- `shaddai-backend/tools-nexus.js` — NEXUS agent tools
- `shaddai-backend/tools-research.js` — ORACLE research tools
- `shaddai-backend/tools-data.js` — data tools

### SHADDAI Agents MCP
- `shaddai-agents-mcp/mcp.js` — MCP server for 7 agents + 48 NVIDIA skills
- `shaddai-agents-mcp/nvidia-skills.json` — skill manifest
- `shaddai-agents-mcp/README.md` — agent documentation

### ZEROX Auto-Trader
- `zerox-autotrader/` — full repo (paper trading engine, strategy routes, frontend dashboard, security audit)
- See `zerox-autotrader/README.md` and `FINAL_SUMMARY.md`

### TuFish (MiroFish Trading Terminal)
- `mirofish-master/` — full repo (trading terminal + Telegram signals bot)
- `mirofish-master/bot/` — engine, signals-bot, paper trading, TA, rugcheck
- `mirofish-master/terminal/` — web trading dashboard
- See `mirofish-master/README.md`

### ASIMOV Trading Agent
- `asimov-site/` — $ASIMOV Science Finance site + trading agent
- `asimov-site/sap.html`, `sap-*.js` — trading terminal UI
- `asimov-site/three-scenes.js`, `hero3d.js` — 3D visualizations
- See `asimov-site/README.md`, `MASTER-PROMPT.md`

### Signals Dashboard
- `TELEGRAM.html` — web dashboard (signal feed, PnL charts, wallet balances, bot status)

### Infrastructure
- `package.json` — dependencies (express)
- `.env.example` — all environment variables documented
- `.gitignore` — ignores node_modules, .env, data/, *.log

---

## The SHADDAI Agent Council

This bot is powered by the **7-agent SHADDAI council**, each with a specialized role:

### ZEROX — Wealth & Revenue Engine
- **Role:** Business logic, billing, pricing, unit economics, financial strategy
- **Owns:** Stripe integration, tier limits, cost tracking, revenue modeling, subscription flows
- **In signals:** Drives the auto-trader loop — SHADDAI signal data feeds trading decisions against a Solana USDC wallet, spend-capped by the agent permit layer and audited by PIKADON
- **Status:** Paper-trading demo (live execution pending)
- **Repo:** [zerox-autotrader](https://github.com/IzzoSol/zerox-autotrader)

### ORACLE — Research & Intelligence
- **Role:** Gathers data, analyzes context, spots trends and gaps
- **Owns:** Market research, competitive analysis, tech trends, feature discovery, observability
- **In signals:** Provides background intelligence before major trading decisions — market regime detection, sentiment analysis, trend identification
- **Integration:** `providers.js` pulls market data that ORACLE analyzes for signal quality

### SHADDAI — Supreme Orchestrator
- **Role:** Executive decision-maker, coordinates all agents, makes final calls
- **In signals:** Final approval gate for which signals get broadcast

### NEXUS — Technical Architect
- **Role:** Backend & infrastructure, code review, scalability
- **In signals:** Maintains the bot's server infrastructure and API integrations

### TURTLE — UI/UX & Creative
- **Role:** Design, frontend, user experience
- **In signals:** Designs the TELEGRAM.html dashboard and bot message formatting

### QUILL — Writing & Communication
- **Role:** Copy, documentation, error messages
- **In signals:** Writes signal message copy and help text

### PIKADON — Security & Compliance
- **Role:** Guard rails, audit logs, permissions, secret management
- **In signals:** Audits the auto-trader's spend caps and permission gates

---

## Related Projects

### TuFish (MiroFish Trading Terminal)
- **Repo:** [mirofish-master](https://github.com/IzzoSol/mirofish-master) (public)
- **Description:** The canonical MiroFish build — trading terminal merged with the Telegram signals bot. Absorbs TuFish, nuatsbot, gemtrack_bot, memecoin-bot, OpenTerminal, nepse-quant, and nofx.
- **Features:** Real-time trading terminal, signal aggregation, Telegram bot integration, portfolio tracking
- **Status:** Private source; last public snapshot in [TuFish](https://github.com/IzzoSol/TuFish)

### Signals Dashboard
- **Location:** `TELEGRAM.html` in this repo — web-based dashboard for the bot
- **Features:** Signal feed, PnL charts, wallet balances, bot status
- **Access:** Served by the bot's Express server on the configured PORT

### ASIMOV Trading Agent (Paper Trading)
- **Repo:** [asimov-site](https://github.com/IzzoSol/asimov-site) (public) + [shaddai-asimov-project](https://github.com/IzzoSol/shaddai-asimov-project)
- **Description:** $ASIMOV Science Finance — pulp-magazine token site with three.js scenes. The ASIMOV trading agent runs paper-trading simulations against SHADDAI signal data.
- **ZEROX Auto-Trader:** [zerox-autotrader](https://github.com/IzzoSol/zerox-autotrader) — SHADDAI signal data driving an auto-trading loop against a Solana USDC wallet, spend-capped by the agent permit layer and audited by PIKADON. Paper-trading demo; live execution pending.

### SHADDAI Main (Agent Empire)
- **Repo:** [Shaddai](https://github.com/IzzoSol/Shaddai) (public)
- **Live:** https://shaddai-g81x.onrender.com
- **Description:** Sovereign AI agent empire — 7 specialized agents, 200+ tools, agent forge, 3D world, marketplace. Runs on your own API key (Groq, Gemini, or OpenRouter).

### SHADDAI Agents MCP
- **Repo:** [shaddai-agents-mcp](https://github.com/IzzoSol/shaddai-agents-mcp) (public)
- **Description:** 7 SHADDAI agents + curated NVIDIA/skills library (48 skills) as MCP server for Claude Code, Cursor, and any MCP client.

---

## Setup

### 1. Clone & Install
```bash
git clone https://github.com/IzzoSol/shaddai-signals.git
cd shaddai-signals
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in your keys (see .env.example for all variables)
```

### 3. Run
```bash
node telegram-bot.js
```

The bot will start polling Telegram and broadcasting signals to the configured channel.

### 4. Dashboard
Open `TELEGRAM.html` in a browser, or visit `http://localhost:PORT` if the Express server is running.

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token (from @BotFather) |
| `TELEGRAM_CHANNEL` | Public channel to broadcast signals (e.g., @ShaddaiSignals) |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `HELIUS_API_KEY` | Helius API key for enhanced Solana data |
| `HF_TOKEN` | Hugging Face token (image generation) |
| `TG_SIGNALS_INTERVAL` | Poll interval in ms (default: 300000 = 5 min) |
| `TG_DATA_DIR` | Data directory for stored calls/signals |
| `PORT` | Express server port (default: 3000) |

---

## Signal Flow

```
DEX APIs (GeckoTerminal, DexScreener)
    ↓
providers.js (fetch market data)
    ↓
pipeline.js (filter candidates)
    ↓
telegram-signals.js (format + broadcast)
    ↓
Telegram Bot API → @ShaddaiSignals channel
    ↓
telegram-pnl.js (record calls, track outcomes)
    ↓
ZEROX auto-trader (paper trading loop)
    ↓
PIKADON audit (spend caps, permissions)
```

---

## Free Setup (No Paid APIs)

This system can run entirely on free tiers:

| Component | Free Option |
|---|---|
| LLM (agents) | Groq (free), Gemini (free), OpenRouter (free models), Ollama (local) |
| Hosting | Render (free tier), GitHub Pages |
| Database | SQLite (local), Supabase (free) |
| RPC | Solana public RPC, Helius free tier |
| Image gen | Hugging Face free inference |
| Bot hosting | Render free web service |

---

## License

MIT — free to use, modify, and distribute.

---

*Built by Izzo (IzzoSol) — github.com/IzzoSol*
'@