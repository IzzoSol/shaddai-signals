# ZA (ZeroX AutoTrader)

## SHADDAI + ZEROX + Paybox Auto-Trader System

### Overview
Sustainable auto-trader using ZEROX-optimized parameters on SHADDAI call data, funded via Paybox Solana USDC wallet, with PIKADON security auditing.

### Architecture
- **MCP Layer**: SHADDAI agent permitting & spend caps
- **Backend**: ZEROX market analysis & trade execution
- **Security**: PIKADON pre/post-trade audits
- **Wallet**: Paybox MCP JSON-RPC over HTTP
- **Front-end**: simple-signals.html integration

### Current Status
- ✅ ZEROX parameters confirmed (4% SL, 12% trail, 6% gap)
- ✅ 200/400-call simulations complete (+90% and +288% ROI)
- ✅ Sustainability analysis passed
- ⏳ Paybox wallet integration pending
- ⏳ tg-calls.json encoding fix needed
- ⏳ API redeployment on Render

### Quick Start
1. Fix tg-calls.json UTF-16 encoding
2. Redeploy /api/pro-signals/feed endpoint
3. Enable paybox-config.json
4. Run paper-trading demo

### Parameters
- Stop loss: 4%
- Trail activate: 12% ROI
- Trail gap: 6%
- Position size: 2% of capital
- Source filter: Trending
- Min holders: 50 (relaxed demo)
- Min TVL: $20k (relaxed demo)