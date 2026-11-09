/* ══════════════════════════════════════════════════════════════════════════
   telegram-wallets.js — Tracked wallet system for SHADDAI signals.

   FEATURES:
   • Watch list: add/remove wallets with labels (alpha wallets, smart money, whales)
   • Signal card integration: shows which tracked wallets are in a token's top holders
   • Real-time ape alerts: polls watched wallets for new token buys → instant TG alert
   • Wallet type labeling: launch wallet, sniper, whale, insider, known alpha

   COMMANDS (handled in telegram-bot.js):
     /watch <address> [label]   — add wallet to watchlist
     /unwatch <address>         — remove wallet
     /wallets                   — list all watched wallets
     /wallet <address>          — show wallet profile (recent buys, hit rate)

   DATA: data/watched-wallets.json
   API:  Solana public RPC (free) + rugcheck topHolders (already collected)
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./telegram-core');

const DATA_DIR = process.env.TG_DATA_DIR || path.join(__dirname, 'data');
const WALLETS_FILE = path.join(DATA_DIR, 'watched-wallets.json');
const WALLET_ALERTS_FILE = path.join(DATA_DIR, 'wallet-alerts.json');

// Solana RPC — uses public mainnet, no key needed. Helius free if env set.
const RPC_URL = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
// Max wallets to actively poll (rate limit protection)
const MAX_ACTIVE_WALLETS = 20;
// How often to poll each wallet for new txns (ms)
const WALLET_POLL_INTERVAL = 120000;  // 2 min
// How far back to look for txns on first check
const FIRST_CHECK_LIMIT = 5;
// Subsequent checks — only need latest
const POLL_LIMIT = 10;

function _ensure() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {} }
function _read(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function _write(f, o) { try { _ensure(); fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) {} }
const _esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function _fmtUsd(n) { const v = Number(n) || 0; if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'; return '$' + v.toFixed(2); }

// ── STORAGE ────────────────────────────────────────────────────────────────
// { address: { address, label, type, addedAt, lastSeen, lastTx, hitCount, totalCalls } }
let _wallets = _read(WALLETS_FILE, {});
// { mintLower: { ts, wallets: [address], symbol, fdv } } — recent wallet alerts (dedupe 24h)
let _alerts = _read(WALLET_ALERTS_FILE, {});

function _saveWallets() { _write(WALLETS_FILE, _wallets); }
function _saveAlerts() { _write(WALLET_ALERTS_FILE, _alerts); }

// ── WALLET MANAGEMENT ──────────────────────────────────────────────────────
function addWallet(address, label, type) {
  if (!address || typeof address !== 'string') return null;
  address = address.trim();
  if (address.length < 32 || address.length > 44) return null;  // basic Solana address check
  const key = address.toLowerCase();
  if (!_wallets[key]) {
    _wallets[key] = {
      address, label: label || _shortAddr(address), type: type || 'alpha',
      addedAt: Date.now(), lastSeen: 0, lastTx: null,
      hitCount: 0, totalCalls: 0, wins: 0,
    };
  } else {
    if (label) _wallets[key].label = label;
    if (type) _wallets[key].type = type;
  }
  _saveWallets();
  return _wallets[key];
}

function removeWallet(address) {
  const key = (address || '').trim().toLowerCase();
  if (!_wallets[key]) return false;
  delete _wallets[key];
  _saveWallets();
  return true;
}

function listWallets() { return Object.values(_wallets); }
function getWallet(address) { return _wallets[(address || '').trim().toLowerCase()] || null; }

function _shortAddr(addr) {
  return addr ? addr.slice(0, 4) + '…' + addr.slice(-4) : '';
}

// ── WALLET TYPES ───────────────────────────────────────────────────────────
const WALLET_TYPE_EMOJI = {
  alpha:   '🎯',
  whale:   '🐋',
  smart:   '🧠',
  kol:     '📣',
  dev:     '⚠️',   // dev wallets = flag, not celebrate
  sniper:  '🔫',
  team:    '👥',
  fund:    '🏦',
};

function _walletEmoji(type) { return WALLET_TYPE_EMOJI[type] || '👁'; }

// ── CROSS-REFERENCE: which tracked wallets are in a token's top holders ────
// Called when posting a signal card. topHolders = rugcheck topHolders array.
// Returns { matches: [{address, label, type, pct, rank}], alertLine: string }
function checkWatchedInHolders(topHolders) {
  if (!topHolders || !topHolders.length) return { matches: [], alertLine: '' };
  const walletList = listWallets();
  if (!walletList.length) return { matches: [], alertLine: '' };

  const matches = [];
  topHolders.forEach((h, idx) => {
    const owner = String(h.owner || h.address || '').toLowerCase();
    if (!owner) return;
    const w = _wallets[owner];
    if (w) {
      matches.push({
        address: w.address, label: w.label, type: w.type,
        pct: Number(h.pct) || 0, rank: idx + 1,
        emoji: _walletEmoji(w.type),
      });
    }
  });

  if (!matches.length) return { matches: [], alertLine: '' };

  const alertLine = matches.map(m =>
    `${m.emoji} <b>${_esc(m.label)}</b> — #${m.rank} holder  ${m.pct.toFixed(2)}%`
  ).join('\n');

  return { matches, alertLine: '\n🎯 <b>TRACKED WALLETS IN</b>\n' + alertLine };
}

// ── LAUNCH WALLET DETECTION ────────────────────────────────────────────────
// Detect if top holder[0] looks like the launch wallet (creator).
// Heuristics: very high concentration, insider flag from rugcheck, round number amounts.
function analyzeLaunchWallet(topHolders, rugData) {
  if (!topHolders || !topHolders.length) return null;
  const top = topHolders[0];
  const pct = Number(top.pct) || 0;
  const isInsider = !!top.insider;
  const addr = top.owner || top.address || '';

  // is it a known lock/burn/pool address?
  const SAFE_RE = /1nc1nerator|dead0000|burn|lp|amm|pool|lock|vault|raydium|meteora|orca/i;
  if (SAFE_RE.test(addr)) return null;  // it's a protocol address, not a dev

  const flags = [];
  if (isInsider) flags.push('insider flagged');
  if (pct > 15) flags.push(pct.toFixed(0) + '% supply');
  if (rugData && rugData.mintAuthority === addr) flags.push('mint authority');

  if (!flags.length && pct < 10) return null;

  return {
    address: addr, pct, isInsider, flags,
    label: isInsider ? '⚠️ Dev/Insider' : (pct > 15 ? '🚨 Large holder' : '👀 Top holder'),
    shortAddr: _shortAddr(addr),
  };
}

// ── WALLET PROFILE CARD (for /wallet command) ──────────────────────────────
function walletCard(address) {
  const w = getWallet(address);
  if (!w) return `❌ Wallet <code>${_esc(_shortAddr(address))}</code> is not on the watchlist.\n\nAdd it with: <code>/watch ${_esc(address)} MyLabel</code>`;
  const hitRate = w.totalCalls > 0 ? Math.round((w.wins / w.totalCalls) * 100) : 0;
  const emoji = _walletEmoji(w.type);
  return (
    `${emoji} <b>${_esc(w.label)}</b>\n` +
    `━━━━━━━━━━━━━\n` +
    `<code>${_esc(w.address)}</code>\n\n` +
    `Type: <b>${_esc(w.type)}</b>\n` +
    `Added: ${new Date(w.addedAt).toLocaleDateString()}\n` +
    (w.totalCalls ? `Calls tracked: <b>${w.totalCalls}</b>  ·  Hit rate: <b>${hitRate}%</b> (${w.wins} wins)\n` : '') +
    (w.lastSeen ? `Last seen: ${new Date(w.lastSeen).toLocaleDateString()}\n` : '') +
    `\n🔗 <a href="https://solscan.io/account/${_esc(w.address)}">Solscan</a>  ·  ` +
    `<a href="https://cielo.finance/wallet/${_esc(w.address)}">Cielo</a>  ·  ` +
    `<a href="https://dexscreener.com/solana?rankBy=volume&order=desc&q=${_esc(w.address)}">DexScreener</a>`
  );
}

// ── WALLETS LIST CARD (for /wallets command) ──────────────────────────────
function walletsListCard() {
  const list = listWallets();
  if (!list.length) return '📋 No wallets on the watchlist.\n\nAdd one: <code>/watch &lt;address&gt; YourLabel</code>';
  const grouped = {};
  for (const w of list) {
    const t = w.type || 'alpha';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(w);
  }
  const watcherActive = list.length > 0;
  let html = `👁 <b>WATCHED WALLETS</b> (${list.length})${watcherActive ? '  ·  🟢 watcher active' : ''}\n━━━━━━━━━━━━━\n\n`;
  for (const [type, wallets] of Object.entries(grouped)) {
    html += `${_walletEmoji(type)} <b>${type.toUpperCase()}</b>\n`;
    for (const w of wallets) {
      const hitRate = w.totalCalls > 0 ? ` · ${Math.round((w.wins / w.totalCalls) * 100)}% win` : '';
      html += `  <code>${_esc(_shortAddr(w.address))}</code> <b>${_esc(w.label)}</b>${hitRate}\n`;
    }
    html += '\n';
  }
  html += `<i>Use /wallet &lt;address&gt; for full profile.\nUse /unwatch &lt;address&gt; to remove.</i>`;
  return html;
}

// ── SOLANA RPC HELPERS ─────────────────────────────────────────────────────
async function _rpc(method, params) {
  try {
    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.result;
  } catch (e) { return null; }
}

// Get recent signatures for a wallet address
async function _getRecentSigs(address, limit) {
  return _rpc('getSignaturesForAddress', [address, { limit: limit || POLL_LIMIT, commitment: 'confirmed' }]);
}

// Parse a transaction to find token purchases (simplified: look for token program interactions)
async function _getTransaction(sig) {
  return _rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
}

// Extract token mints bought in a transaction (look for token transfers where our wallet received tokens)
function _extractBoughtTokens(tx, walletAddress) {
  if (!tx || !tx.meta) return [];
  const bought = [];
  try {
    // Check post/pre token balance changes
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];
    const walletLower = walletAddress.toLowerCase();

    // Find token accounts that gained tokens
    for (const post of postBalances) {
      if (String(post.owner || '').toLowerCase() !== walletLower) continue;
      const mint = post.mint;
      if (!mint) continue;
      const pre = preBalances.find(b => b.accountIndex === post.accountIndex);
      const preBal = Number((pre && pre.uiTokenAmount && pre.uiTokenAmount.uiAmount) || 0);
      const postBal = Number((post.uiTokenAmount && post.uiTokenAmount.uiAmount) || 0);
      if (postBal > preBal) {
        bought.push({ mint, amount: postBal - preBal, postBal });
      }
    }
  } catch (e) {}
  return bought;
}

// ── REAL-TIME APE DETECTION ────────────────────────────────────────────────
// For each watched wallet, poll recent transactions.
// If a new token buy is found → look it up → alert if it passes basic quality checks.
const _lastTxSeen = {};  // address → last tx sig seen

async function _pollWallet(w) {
  try {
    const sigs = await _getRecentSigs(w.address, _lastTxSeen[w.address] ? POLL_LIMIT : FIRST_CHECK_LIMIT);
    if (!Array.isArray(sigs) || !sigs.length) return;

    const lastKnown = _lastTxSeen[w.address];
    const newSigs = lastKnown ? sigs.filter(s => s.signature !== lastKnown) : [];
    _lastTxSeen[w.address] = sigs[0].signature;  // always update to latest

    // first poll just seeds — don't alert on historical txns
    if (!lastKnown) return;
    if (!newSigs.length) return;

    // only check up to 3 newest txns per poll (rate limit)
    for (const sigInfo of newSigs.slice(0, 3)) {
      if (sigInfo.err) continue;  // failed tx
      const tx = await _getTransaction(sigInfo.signature);
      const bought = _extractBoughtTokens(tx, w.address);
      for (const b of bought) {
        await _handleWalletBuy(w, b.mint, b.amount, sigInfo.signature);
      }
    }
  } catch (e) {}
}

async function _handleWalletBuy(w, mint, amount, sig) {
  // dedupe — don't alert the same wallet+mint twice within 24h
  const alertKey = (w.address + ':' + mint).toLowerCase();
  const alertTs = _alerts[alertKey];
  if (alertTs && Date.now() - alertTs < 24 * 3600 * 1000) return;

  // quick quality check via DexScreener
  let tokenInfo = null;
  let fdv = 0, liq = 0, symbol = '', name = '';
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const j = await r.json();
      const pair = ((j && j.pairs) || []).sort((a, b) => (b.liquidity && b.liquidity.usd || 0) - (a.liquidity && a.liquidity.usd || 0))[0];
      if (pair) {
        fdv = Number(pair.fdv || pair.marketCap) || 0;
        liq = Number(pair.liquidity && pair.liquidity.usd) || 0;
        symbol = (pair.baseToken && pair.baseToken.symbol) || '';
        name = (pair.baseToken && pair.baseToken.name) || '';
        tokenInfo = pair;
      }
    }
  } catch (e) {}

  // skip SOL/USDC/wrapped assets
  const SKIP = ['so11111111111111111111111111111111111111112', 'epje', 'usdc', 'usdt', 'wsol'];
  if (SKIP.some(s => mint.toLowerCase().includes(s) || symbol.toLowerCase() === s)) return;

  // skip if no market data yet (too fresh for DexScreener)
  if (!liq || liq < 500) return;

  _alerts[alertKey] = Date.now();
  _saveAlerts();

  // Update wallet stats
  const key = w.address.toLowerCase();
  if (_wallets[key]) { _wallets[key].lastSeen = Date.now(); _wallets[key].totalCalls++; _saveWallets(); }

  const emoji = _walletEmoji(w.type);
  const dsUrl = tokenInfo && tokenInfo.url ? tokenInfo.url : ('https://dexscreener.com/solana/' + mint);
  const html = (
    `${emoji} <b>WALLET ALERT</b>\n` +
    `━━━━━━━━━━━━━\n` +
    `<b>${_esc(w.label)}</b> just aped\n\n` +
    `🪙 <b>${symbol ? '$' + _esc(symbol) : '???'}</b>${name && name !== symbol ? '  ' + _esc(name) : ''}\n` +
    (fdv ? `💰 MC <b>${_fmtUsd(fdv)}</b>   💧 Liq <b>${_fmtUsd(liq)}</b>\n` : '') +
    `\n<code>${_esc(mint)}</code>\n` +
    `🔗 <a href="${_esc(dsUrl)}">Chart</a>  ·  ` +
    `<a href="https://solscan.io/tx/${_esc(sig)}">TX</a>  ·  ` +
    `<a href="https://solscan.io/account/${_esc(w.address)}">Wallet</a>\n\n` +
    `<i>NFA · DYOR — wallet tracking alert</i>`
  );

  await core.broadcast(html, { buttons: core.buildButtons(mint, 'solana', dsUrl) });
  console.log(`[wallets] 🚨 ALERT: ${w.label} (${w.type}) aped into ${symbol || mint.slice(0, 8)}`);
}

// ── WATCHER LOOP ───────────────────────────────────────────────────────────
let _watchTimer = null;

function startWalletWatcher() {
  if (_watchTimer) return;
  const wallets = listWallets();
  if (!wallets.length) return;
  console.log(`[wallets] watcher started — tracking ${wallets.length} wallet(s)`);

  // stagger initial polls so we don't hammer RPC at startup
  wallets.slice(0, MAX_ACTIVE_WALLETS).forEach((w, i) => {
    setTimeout(() => { _pollWallet(w).catch(() => {}); }, i * 3000);
  });

  _watchTimer = setInterval(() => {
    const list = listWallets().slice(0, MAX_ACTIVE_WALLETS);
    list.forEach((w, i) => {
      setTimeout(() => { _pollWallet(w).catch(() => {}); }, i * 2000);
    });
  }, WALLET_POLL_INTERVAL);

  if (_watchTimer.unref) _watchTimer.unref();
}

function stopWalletWatcher() {
  if (_watchTimer) { clearInterval(_watchTimer); _watchTimer = null; }
}

// Restart watcher if a wallet was added/removed while running
function restartWatcher() {
  if (_watchTimer) { stopWalletWatcher(); startWalletWatcher(); }
}

// ── EXPORTS ────────────────────────────────────────────────────────────────
module.exports = {
  // wallet management
  addWallet, removeWallet, listWallets, getWallet,
  // signal card integration
  checkWatchedInHolders, analyzeLaunchWallet,
  // UI cards
  walletCard, walletsListCard,
  // watcher
  startWalletWatcher, stopWalletWatcher, restartWatcher,
  // internals exposed for testing
  _pollWallet, _handleWalletBuy,
};
