class Candle {
  constructor(k) {
    this.time = k[0];
    this.open = +k[1];
    this.high = +k[2];
    this.low = +k[3];
    this.close = +k[4];
    this.volume = +k[5];
  }
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const rsi = new Array(closes.length).fill(50);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function linregSlope(values) {
  const n = values.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += values[i]; sxy += i * values[i]; sxx += i * i; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

function volumeSpike(candles) {
  if (candles.length < 30) return 0;
  const recent = candles.slice(-30);
  const avgVol = recent.slice(0, -2).reduce((a, c) => a + c.volume, 0) / 28;
  const lastAvg = (recent[recent.length - 1].volume + recent[recent.length - 2].volume) / 2;
  if (avgVol === 0) return 0;
  return (lastAvg - avgVol) / avgVol;
}

function divergence(closes, rsi) {
  const windows = [10, 20, 30, 40];
  let bull = 0, bear = 0;
  for (const w of windows) {
    if (closes.length < w) continue;
    const ps = linregSlope(closes.slice(-w));
    const rs = linregSlope(rsi.slice(-w));
    const normP = ps / (closes[closes.length - 1] || 1);
    const normR = rs / 100;
    if (normR > 0.001 && normP < -0.001) bull++;
    else if (normR < -0.001 && normP > 0.001) bear++;
  }
  return { bull, bear };
}

function analyze(symbol, candles, opts = {}) {
  const o = Object.assign({ rsiOverbought: 70, rsiOversold: 30, volumeGrowthThreshold: 5, divergenceConfirmations: 3 }, opts);
  const signals = [];
  if (!candles.length) return signals;
  const closes = candles.map(c => c.close);
  const rsi = computeRSI(closes);
  if (!rsi.length) return signals;
  const last = rsi[rsi.length - 1];

  if (last > o.rsiOverbought) signals.push({ code: 'RSI_HIGH', side: 'sell', symbol, strength: Math.min(95, 60 + (last - o.rsiOverbought) * 1.5), text: `${symbol}: RSI ${last.toFixed(1)} overbought` });
  else if (last < o.rsiOversold) signals.push({ code: 'RSI_LOW', side: 'buy', symbol, strength: Math.min(95, 60 + (o.rsiOversold - last) * 1.5), text: `${symbol}: RSI ${last.toFixed(1)} oversold` });

  const growth = volumeSpike(candles);
  if (growth > o.volumeGrowthThreshold) signals.push({ code: 'VOL_SPIKE', side: 'buy', symbol, strength: Math.min(92, 55 + growth * 6), text: `${symbol}: volume +${(growth * 100).toFixed(0)}% above 30-bar average` });

  const { bull, bear } = divergence(closes, rsi);
  if (bull >= o.divergenceConfirmations) signals.push({ code: 'BULL_DIV', side: 'buy', symbol, strength: 70 + bull * 6, text: `${symbol}: bullish divergence (${bull} window confirmations)` });
  if (bear >= o.divergenceConfirmations) signals.push({ code: 'BEAR_DIV', side: 'sell', symbol, strength: 70 + bear * 6, text: `${symbol}: bearish divergence (${bear} window confirmations)` });

  return signals;
}

module.exports = { Candle, computeRSI, linregSlope, volumeSpike, divergence, analyze };

if (require.main === module) {
  const n = 200;
  const candles = Array.from({ length: n }, (_, i) => {
    const trend = i < n / 2 ? i * 0.05 : (n / 2) * 0.05 - (i - n / 2) * 0.12;
    const noise = Math.sin(i * 0.7) * 0.3;
    const close = 100 + trend + noise;
    return new Candle([i, close - 0.1, close + 0.2, close - 0.2, close, i > n - 4 ? 5000 : 100 + Math.abs(Math.sin(i)) * 50, i * 60000]);
  });
  const rsi = computeRSI(candles.map(c => c.close));
  console.log('RSI last:', rsi[rsi.length - 1].toFixed(2));
  console.log('Volume growth:', (volumeSpike(candles) * 100).toFixed(0) + '%');
  console.log('Divergence:', JSON.stringify(divergence(candles.map(c => c.close), rsi)));
  const sigs = analyze('TESTUSDT', candles);
  console.log('Signals:', sigs.map(s => s.code + ' ' + s.strength).join(', '));
  if (!rsi.length || !sigs.length) { console.error('SELF-TEST FAILED'); process.exit(1); }
  console.log('SELF-TEST OK');
}
