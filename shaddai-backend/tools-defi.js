'use strict';

/**
 * SHADDAI tools-defi.js
 * Real DeFi data tools for ZEROX, inspired by Sperax/DeFi-Agents-API.
 * Keyless public APIs (DeFiLlama, DexScreener) — work immediately, no config.
 *
 * Merge into the main TOOLS registry with:
 *   Object.assign(TOOLS, require('./tools-defi').TOOLS_DEFI);
 *
 * Tools: defi_tvl, defi_yields, defi_token_price, defi_chains_tvl
 */

const axios = require('axios');

const UA = { 'User-Agent': 'SHADDAI-Agent/2.0 (shaddai.ai)' };

/** Wrap a promise so it rejects after `ms` milliseconds. */
function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    )
  ]);
}

function errMsg(err) {
  const d = err && err.response && err.response.data;
  if (d) return typeof d === 'string' ? d.slice(0, 300) : (d.message || JSON.stringify(d).slice(0, 300));
  return err && err.message ? err.message : String(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLS_DEFI registry
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS_DEFI = {

  defi_tvl: {
    name: 'defi_tvl',
    description: 'Total Value Locked (TVL) for a DeFi protocol via DeFiLlama (keyless). Returns current total TVL in USD plus a per-chain breakdown. Pass the protocol slug, e.g. "aave", "uniswap", "lido", "makerdao".',
    schema: {
      protocol: 'string — DeFiLlama protocol slug, e.g. "aave", "uniswap", "lido"'
    },
    agents: ['ZEROX', 'ORACLE'],
    async execute({ protocol }) {
      if (!protocol || typeof protocol !== 'string') {
        return JSON.stringify({ success: false, error: 'protocol slug is required, e.g. "aave"' });
      }
      const slug = protocol.trim().toLowerCase().replace(/\s+/g, '-');
      try {
        const resp = await withTimeout(
          axios.get(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`, {
            timeout: 12000, headers: UA
          }),
          14000
        );
        const d = resp.data || {};

        // currentChainTvls = { Ethereum: 123, Polygon: 45, "Ethereum-staking": ... }
        const chainTvls = d.currentChainTvls || {};
        const chains = Object.entries(chainTvls)
          .filter(([k]) => !/-/.test(k)) // skip composite keys like "Ethereum-staking"
          .map(([chain, tvl]) => ({ chain, tvlUsd: Math.round(tvl) }))
          .sort((a, b) => b.tvlUsd - a.tvlUsd);

        // Latest total TVL from the tvl time-series, fall back to summed chains.
        let totalTvl = null;
        if (Array.isArray(d.tvl) && d.tvl.length) {
          totalTvl = d.tvl[d.tvl.length - 1].totalLiquidityUSD;
        }
        if (totalTvl == null) {
          totalTvl = chains.reduce((s, c) => s + c.tvlUsd, 0);
        }

        return JSON.stringify({
          success: true,
          source: 'defillama',
          protocol: d.name || slug,
          symbol: d.symbol || null,
          category: d.category || null,
          url: d.url || null,
          tvlUsd: Math.round(totalTvl),
          chainCount: chains.length,
          chains: chains.slice(0, 25)
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: errMsg(err), protocol: slug });
      }
    }
  },

  defi_yields: {
    name: 'defi_yields',
    description: 'Top DeFi yield/farming pools by APY via DeFiLlama Yields (keyless). Optionally filter by chain (e.g. "Ethereum", "Arbitrum") and/or project (e.g. "aave-v3", "lido"). Returns symbol, chain, project, apy, and tvlUsd for the top pools.',
    schema: {
      chain: 'string — optional: filter by chain, e.g. "Ethereum", "Arbitrum", "Solana"',
      project: 'string — optional: filter by project slug, e.g. "aave-v3", "lido"',
      limit: 'number — max pools to return (default 10, max 50)'
    },
    agents: ['ZEROX', 'ORACLE'],
    async execute({ chain, project, limit = 10 } = {}) {
      const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
      try {
        const resp = await withTimeout(
          axios.get('https://yields.llama.fi/pools', { timeout: 15000, headers: UA }),
          17000
        );
        let pools = (resp.data && resp.data.data) || [];
        if (!Array.isArray(pools) || !pools.length) {
          return JSON.stringify({ success: false, error: 'No pool data returned from DeFiLlama yields' });
        }

        if (chain) {
          const c = String(chain).toLowerCase();
          pools = pools.filter(p => String(p.chain || '').toLowerCase() === c);
        }
        if (project) {
          const pr = String(project).toLowerCase();
          pools = pools.filter(p => String(p.project || '').toLowerCase().includes(pr));
        }

        pools = pools
          .filter(p => typeof p.apy === 'number')
          .sort((a, b) => b.apy - a.apy)
          .slice(0, n)
          .map(p => ({
            symbol: p.symbol,
            chain: p.chain,
            project: p.project,
            apy: p.apy != null ? +p.apy.toFixed(2) : null,
            apyBase: p.apyBase != null ? +p.apyBase.toFixed(2) : null,
            apyReward: p.apyReward != null ? +p.apyReward.toFixed(2) : null,
            tvlUsd: p.tvlUsd != null ? Math.round(p.tvlUsd) : null,
            stablecoin: !!p.stablecoin,
            ilRisk: p.ilRisk || null
          }));

        return JSON.stringify({
          success: true,
          source: 'defillama-yields',
          filters: { chain: chain || null, project: project || null },
          returned: pools.length,
          pools
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: errMsg(err) });
      }
    }
  },

  defi_token_price: {
    name: 'defi_token_price',
    description: 'Live token price, liquidity, and 24h change via DexScreener (keyless). Accepts a token contract address (any chain) or a symbol/name to search. Returns the most-liquid trading pair: price in USD, 24h price change %, liquidity, volume, chain and DEX.',
    schema: {
      query: 'string — token contract address (0x... / mint) OR a symbol/name to search, e.g. "SPA", "PEPE"'
    },
    agents: ['ZEROX', 'ORACLE'],
    async execute({ query } = {}) {
      if (!query || typeof query !== 'string') {
        return JSON.stringify({ success: false, error: 'query is required (token address or symbol)' });
      }
      const q = query.trim();
      // Heuristic: EVM 0x address (40 hex) or a long base58 Solana mint → token lookup; else search.
      const isAddress = /^0x[a-fA-F0-9]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
      try {
        let pairs = [];
        if (isAddress) {
          const resp = await withTimeout(
            axios.get(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(q)}`, {
              timeout: 12000, headers: UA
            }),
            14000
          );
          pairs = (resp.data && resp.data.pairs) || [];
        } else {
          const resp = await withTimeout(
            axios.get('https://api.dexscreener.com/latest/dex/search', {
              params: { q }, timeout: 12000, headers: UA
            }),
            14000
          );
          pairs = (resp.data && resp.data.pairs) || [];
        }

        if (!pairs.length) {
          return JSON.stringify({ success: false, error: `No DexScreener pairs found for "${q}"`, query: q });
        }

        // Pick the most liquid pair.
        pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        const p = pairs[0];

        return JSON.stringify({
          success: true,
          source: 'dexscreener',
          query: q,
          token: {
            name: p.baseToken?.name || null,
            symbol: p.baseToken?.symbol || null,
            address: p.baseToken?.address || null
          },
          priceUsd: p.priceUsd != null ? parseFloat(p.priceUsd) : null,
          priceNative: p.priceNative != null ? parseFloat(p.priceNative) : null,
          change24hPct: p.priceChange?.h24 != null ? +Number(p.priceChange.h24).toFixed(2) : null,
          liquidityUsd: p.liquidity?.usd != null ? Math.round(p.liquidity.usd) : null,
          volume24hUsd: p.volume?.h24 != null ? Math.round(p.volume.h24) : null,
          chain: p.chainId || null,
          dex: p.dexId || null,
          pairUrl: p.url || null,
          matchedPairs: pairs.length
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: errMsg(err), query: q });
      }
    }
  },

  defi_chains_tvl: {
    name: 'defi_chains_tvl',
    description: 'TVL ranked by blockchain across all of DeFi via DeFiLlama (keyless, https://api.llama.fi/v2/chains). Returns the top chains by total value locked in USD.',
    schema: {
      limit: 'number — max chains to return (default 15, max 50)'
    },
    agents: ['ZEROX', 'ORACLE'],
    async execute({ limit = 15 } = {}) {
      const n = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50);
      try {
        const resp = await withTimeout(
          axios.get('https://api.llama.fi/v2/chains', { timeout: 12000, headers: UA }),
          14000
        );
        let chains = resp.data || [];
        if (!Array.isArray(chains) || !chains.length) {
          return JSON.stringify({ success: false, error: 'No chain data returned from DeFiLlama' });
        }

        const total = chains.reduce((s, c) => s + (c.tvl || 0), 0);

        chains = chains
          .filter(c => typeof c.tvl === 'number')
          .sort((a, b) => b.tvl - a.tvl)
          .slice(0, n)
          .map(c => ({
            chain: c.name,
            tokenSymbol: c.tokenSymbol || null,
            tvlUsd: Math.round(c.tvl),
            sharePct: total ? +((c.tvl / total) * 100).toFixed(2) : null
          }));

        return JSON.stringify({
          success: true,
          source: 'defillama',
          totalTvlUsd: Math.round(total),
          returned: chains.length,
          chains
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: errMsg(err) });
      }
    }
  }

};

module.exports = { TOOLS_DEFI };
