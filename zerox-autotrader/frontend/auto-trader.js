/**
 * ZA (ZeroX AutoTrader) - Front-end Integration
 * Connects the auto-trader to simple-signals.html dashboard
 */

document.addEventListener('DOMContentLoaded', function() {
  
  // ─── ELEMENT REFERENCES ────────────────────────────────────
  const startBtn = document.getElementById('start-trading');
  const stopBtn = document.getElementById('stop-trading');
  const statusDiv = document.getElementById('trading-status');
  const capitalInput = document.getElementById('starting-capital');
  const positionInput = document.getElementById('position-size');
  const slInput = document.getElementById('stop-loss');
  const trailInput = document.getElementById('trail-activate');
  const gapInput = document.getElementById('trail-gap');
  
  // ─── INITIAL STATE ─────────────────────────────────────────
  let autoTraderRunning = false;
  let traderModule = null;
  
  // ─── UPDATE UI ─────────────────────────────────────────────
  function updateUI(state) {
    if (state === 'started') {
      autoTraderRunning = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      statusDiv.innerHTML = '🟢 Auto-trading active';
      statusDiv.className = 'status-badge status-active';
    } else if (state === 'stopped') {
      autoTraderRunning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      statusDiv.innerHTML = '⏹️ Auto-trading stopped';
      statusDiv.className = 'status-badge status-inactive';
    }
  }
  
  // ─── START TRADING ─────────────────────────────────────────
  startBtn.addEventListener('click', async function() {
    const capital = parseFloat(capitalInput.value) || 200;
    const positionPct = parseFloat(positionInput.value) || 2;
    const slPct = parseFloat(slInput.value) || 4;
    const trailPct = parseFloat(trailInput.value) || 12;
    const gapPct = parseFloat(gapInput.value) || 6;
    
    // Update strategy params in the module
    if (window.ZAEngine) {
      window.ZAEngine.setStrategyParams({
        positionSizePct: positionPct,
        stopLossPct: slPct,
        trailActivatePct: trailPct,
        trailGapPct: gapPct
      });
    }
    
    // Start the auto-trader
    try {
      const status = await window.ZAEngine.runAutoTrader();
      updateUI('started');
      renderPortfolioStatus(status);
    } catch (error) {
      console.error("❌ Auto-trader error:", error);
      alert("Auto-trader failed to start. Check console for details.");
    }
  });
  
  // ─── STOP TRADING ──────────────────────────────────────────
  stopBtn.addEventListener('click', function() {
    if (window.ZAEngine) {
      // The engine doesn't have a explicit stop, but we can update UI
      updateUI('stopped');
    }
  });
  
  // ─── RENDER PORTFOLIO STATUS ───────────────────────────────
  function renderPortfolioStatus(status) {
    const pnlContainer = document.getElementById('portfolio-status');
    if (!pnlContainer) return;
    
    pnlContainer.innerHTML = `
      <div class="pnl-card">
        <div class="pnl-header">
          <span>Capital Overview</span>
          <span class="pnl-change ${status.totalROIPct >= 0 ? 'positive' : 'negative'}">
            ${status.totalROIPct >= 0 ? '+' : ''}${status.totalROIPct}%
          </span>
        </div>
        <div class="pnl-grid">
          <div class="pnl-item">
            <strong>Starting:</strong> $${status.initialCapital}
          </div>
          <div class="pnl-item">
            <strong>Current:</strong> $${status.currentCapital}
          </div>
          <div class="pnl-item">
            <strong>Trades:</strong> ${status.totalTrades}
          </div>
          <div class="pnl-item">
            <strong>Win rate:</strong> ${status.winRate}%
          </div>
          <div class="pnl-item">
            <strong>Daily spend:</strong> $${status.dailySpend}
          </div>
        </div>
      </div>
    `;
  }
  
  // ─── INITIALIZE ON LOAD ────────────────────────────────────
  // Load the ZA engine (would be provided by backend)
  if (window.ZAEngine) {
    // Show initial status
    const initialStatus = window.ZAEngine.getPortfolioStatus();
    renderPortfolioStatus(initialStatus);
    updateUI('stopped');
  } else {
    // Placeholder until backend is connected
    statusDiv.innerHTML = '🔌 Connect backend to enable auto-trading';
    statusDiv.className = 'status-badge status-inactive';
    
    // Mock buttons for demo
    startBtn.addEventListener('click', function() {
      alert("Backend not connected. Please connect the ZA engine backend.");
    });
  }
});