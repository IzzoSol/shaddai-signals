const RUGCHECK_API = 'https://api.rugcheck.xyz/v1/tokens/';

async function check(mint) {
  for (const path of ['report/summary', 'report']) {
    try {
      const res = await fetch(RUGCHECK_API + mint + '/' + path, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      return await res.json();
    } catch {}
  }
  return null;
}

function topHolderPct(report) {
  const holders = report?.topHolders || [];
  return holders.slice(0, 10).reduce((a, h) => a + (h.pct || 0), 0);
}

function gate(report, opts = {}) {
  const o = Object.assign({ maxScore: 2500, maxTopHolderPct: 35 }, opts);
  if (!report) return { pass: false, reasons: ['no rugcheck data'] };
  const reasons = [];
  if (report.rugged) reasons.push('RUGGED (already pulled)');
  if (report.score > o.maxScore) reasons.push(`risk score ${report.score} > ${o.maxScore}`);
  if (report.tokenMeta?.mutable) reasons.push('metadata mutable');
  if (report.mintAuthority) reasons.push('mint authority active');
  if (report.freezeAuthority) reasons.push('freeze authority active');
  const tp = topHolderPct(report);
  if (tp > o.maxTopHolderPct) reasons.push(`top-10 holders own ${tp.toFixed(1)}%`);
  return { pass: reasons.length === 0, reasons, score: report.score, topHolderPct: tp };
}

function formatCard(report, symbol) {
  const sym = symbol || report?.tokenMeta?.symbol || 'TOKEN';
  const mint = report?.mint || report?.token?.mint || '';
  const g = gate(report);
  const score = report?.score ?? '?';
  const liq = report?.totalMarketLiquidity ? '$' + Math.round(report.totalMarketLiquidity).toLocaleString() : 'n/a';
  const holders = (report?.topHolders || []).slice(0, 5).map((h, i) => `${i + 1}. ${(h.pct || 0).toFixed(1)}%`).join(' | ');
  return [
    `${g.pass ? '✅' : '⚠️'} ${sym} — RugCheck score ${score}`,
    `Liquidity: ${liq} | Top-10 holders: ${(g.topHolderPct || 0).toFixed(1)}%`,
    holders ? `Top holders: ${holders}` : '',
    `Authorities: mint ${report?.mintAuthority ? 'ACTIVE ⚠️' : 'revoked ✅'}, freeze ${report?.freezeAuthority ? 'ACTIVE ⚠️' : 'revoked ✅'}`,
    g.reasons.length ? `Flags: ${g.reasons.join('; ')}` : 'Flags: none — clean',
    mint ? `CA: ${mint}` : '',
    `https://gmgn.me/token/${mint}`
  ].filter(Boolean).join('\n');
}

module.exports = { check, gate, formatCard, topHolderPct };
