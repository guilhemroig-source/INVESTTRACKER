/**
 * Indicateurs techniques classiques, calculés sur des séries journalières (cours ajustés).
 * Chaque fonction renvoie un tableau aligné sur l'entrée (null tant que la fenêtre n'est pas remplie).
 */

export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }
type Series = (number | null)[];

export function sma(values: number[], n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values: Series, n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev: number | null = null, count = 0, seed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed += v; count++;
      if (count === n) { prev = seed / n; out[i] = prev; }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI de Wilder (14 jours par défaut). */
export function rsi(close: number[], n = 14): Series {
  const out: Series = new Array(close.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) {
      gain += g; loss += l;
      if (i === n) { gain /= n; loss /= n; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

/** MACD (12, 26, 9) : ligne, signal, histogramme. */
export function macd(close: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(close, fast), s = ema(close, slow);
  const line: Series = close.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const sig = ema(line, signal);
  const hist: Series = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i]! : null));
  return { line, signal: sig, hist };
}

/** Bandes de Bollinger (20 jours, 2 écarts-types) ; %B = position du cours dans les bandes (0 = basse, 1 = haute). */
export function bollinger(close: number[], n = 20, k = 2) {
  const mid = sma(close, n);
  const upper: Series = [], lower: Series = [], pctB: Series = [], width: Series = [];
  for (let i = 0; i < close.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); pctB.push(null); width.push(null); continue; }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (close[j] - mid[i]!) ** 2;
    const sd = Math.sqrt(v / n);
    const u = mid[i]! + k * sd, l = mid[i]! - k * sd;
    upper.push(u); lower.push(l);
    pctB.push(u === l ? 0.5 : (close[i] - l) / (u - l));
    width.push(mid[i] ? (u - l) / mid[i]! : null);
  }
  return { mid, upper, lower, pctB, width };
}

/** Stochastique lent (14, 3, 3) : %K lissé et %D. */
export function stochastic(bars: Bar[], n = 14, smoothK = 3, d = 3) {
  const raw: Series = bars.map((_, i) => {
    if (i < n - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, bars[j].high); lo = Math.min(lo, bars[j].low); }
    return hi === lo ? 50 : ((bars[i].close - lo) / (hi - lo)) * 100;
  });
  const smooth = (s: Series, m: number): Series => s.map((_, i) => {
    if (i < m - 1) return null;
    const w = s.slice(i - m + 1, i + 1);
    return w.some((x) => x == null) ? null : (w as number[]).reduce((a, b) => a + b, 0) / m;
  });
  const k = smooth(raw, smoothK);
  return { k, d: smooth(k, d) };
}

/** Points pivots (plus hauts / plus bas locaux sur ±w jours), base des supports et résistances. */
export function pivots(bars: Bar[], w = 5) {
  const highs: { i: number; price: number }[] = [], lows: { i: number; price: number }[] = [];
  for (let i = w; i < bars.length - w; i++) {
    const win = bars.slice(i - w, i + w + 1);
    if (bars[i].high === Math.max(...win.map((b) => b.high))) highs.push({ i, price: bars[i].high });
    if (bars[i].low === Math.min(...win.map((b) => b.low))) lows.push({ i, price: bars[i].low });
  }
  return { highs, lows };
}

/** Regroupe des niveaux proches (à moins de tol %) et compte combien de fois chacun a été touché. */
export function clusterLevels(levels: number[], tol = 0.02): { price: number; touches: number }[] {
  const sorted = [...levels].sort((a, b) => a - b);
  const out: { price: number; touches: number; sum: number }[] = [];
  for (const p of sorted) {
    const last = out.at(-1);
    if (last && Math.abs(p - last.price) / last.price <= tol) { last.sum += p; last.touches++; last.price = last.sum / last.touches; }
    else out.push({ price: p, touches: 1, sum: p });
  }
  return out.map(({ price, touches }) => ({ price, touches }));
}

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
