import { type Bar, FIB_RATIOS, bollinger, clusterLevels, macd, pivots, rsi, sma, stochastic } from "./indicators";

export type Signal = "haussier" | "baissier" | "neutre";
export type Accord = "pour" | "contre" | "neutre";
export type IndicatorId = "rsi" | "mm" | "macd" | "bollinger" | "volume" | "sr" | "fibo" | "stoch";

export interface Reading { id: IndicatorId; titre: string; valeur: string; lecture: string; signal: Signal; accord: Accord }

export interface TradeInput {
  source: string; // '13F' | 'ARK' | 'FORM4' | 'TRUMP' | 'CONGRES'
  sens: "achat" | "vente";
  operation: string;
  dateOperation: string | null;
  datePublication: string;
  qui?: string;
  montantUsd?: number | null;
  /** 13F : « T2 2026 » (la date exacte des achats dans le trimestre est inconnue). */
  trimestre?: string | null;
}

export interface ChartData {
  dates: string[]; close: number[]; volume: number[]; refIndex: number;
  sma20: (number | null)[]; sma50: (number | null)[]; sma200: (number | null)[];
  rsi: (number | null)[]; macd: (number | null)[]; macdSignal: (number | null)[]; macdHist: (number | null)[];
  bbUpper: (number | null)[]; bbMid: (number | null)[]; bbLower: (number | null)[];
  stochK: (number | null)[]; stochD: (number | null)[];
  support: number | null; resistance: number | null; levels: { price: number; touches: number }[];
  fib: { ratio: number; price: number }[]; fibTrend: "hausse" | "baisse" | null; periodStart?: number;
}

export interface Analysis {
  statut: "ok" | "insuffisant";
  raison?: string;
  refDate: string; close: number;
  readings: Reading[];
  pour: number; contre: number; neutres: number;
  verdict: { titre: string; texte: string; ton: "coherent" | "contre" | "mitige" };
  motif: { titre: string; texte: string };
  suite: { jours: number; date: string; perf: number }[];
  periode?: { debut: string; fin: string; perf: number; min: number; max: number };
  chart: ChartData;
}

const pct = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d).replace(".", ",")} %`;
const num = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const usd = (x: number) => `${num(x, x >= 100 ? 0 : 2)} $`;
const at = <T,>(s: T[], i: number) => (i >= 0 && i < s.length ? s[i] : (null as T));

function accordOf(sig: Signal, sens: "achat" | "vente"): Accord {
  if (sig === "neutre") return "neutre";
  return (sig === "haussier") === (sens === "achat") ? "pour" : "contre";
}

/** Dernier indice de séance ≤ date. */
function indexAtOrBefore(bars: Bar[], date: string): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

const QUARTER_START: Record<string, string> = { "1": "01-01", "2": "04-01", "3": "07-01", "4": "10-01" };
const QUARTER_END: Record<string, string> = { "1": "03-31", "2": "06-30", "3": "09-30", "4": "12-31" };

/** Analyse technique d'une opération à partir des cours journaliers (triés par date, ajustés). */
export function analyzeTrade(bars: Bar[], t: TradeInput): Analysis {
  const q = t.trimestre ? /^T([1-4]) (\d{4})$/.exec(t.trimestre) : null;
  const refDate = q ? `${q[2]}-${QUARTER_END[q[1]]}` : t.dateOperation ?? t.datePublication;
  const i = indexAtOrBefore(bars, refDate);
  const empty = (raison: string): Analysis => ({
    statut: "insuffisant", raison, refDate, close: NaN, readings: [], pour: 0, contre: 0, neutres: 0,
    verdict: { titre: "Analyse impossible", texte: raison, ton: "mitige" }, motif: motifOf(t), suite: [],
    chart: { dates: [], close: [], volume: [], refIndex: -1, sma20: [], sma50: [], sma200: [], rsi: [], macd: [], macdSignal: [], macdHist: [], bbUpper: [], bbMid: [], bbLower: [], stochK: [], stochD: [], support: null, resistance: null, levels: [], fib: [], fibTrend: null },
  });
  if (i < 0) return empty(`Pas de cours disponible avant le ${refDate}.`);
  if (i < 60) return empty(`Historique trop court avant le ${refDate} (${i + 1} séances ; 60 au minimum).`);

  const close = bars.map((b) => b.close), vol = bars.map((b) => b.volume);
  const s20 = sma(close, 20), s50 = sma(close, 50), s200 = sma(close, 200);
  const r = rsi(close), m = macd(close), bb = bollinger(close), st = stochastic(bars);
  const c = close[i];
  const readings: Reading[] = [];
  const add = (id: IndicatorId, titre: string, valeur: string, lecture: string, signal: Signal) =>
    readings.push({ id, titre, valeur, lecture, signal, accord: accordOf(signal, t.sens) });

  // 01 RSI
  {
    const v = r[i]!, recent = r.slice(Math.max(0, i - 10), i).filter((x): x is number => x != null);
    const wasLow = recent.some((x) => x < 30), wasHigh = recent.some((x) => x > 70);
    let sig: Signal = "neutre", txt: string;
    if (v < 30) { sig = "haussier"; txt = `RSI à ${num(v, 0)} : l'action est en survente (sous 30). Lecture classique : la baisse est excessive, un rebond est probable — signal d'achat.`; }
    else if (v > 70) { sig = "baissier"; txt = `RSI à ${num(v, 0)} : l'action est en surachat (au-dessus de 70). Lecture classique : la hausse est tendue, risque de repli — signal de vente.`; }
    else if (wasLow && v < 50) { sig = "haussier"; txt = `RSI à ${num(v, 0)}, il sort de la zone de survente des jours précédents : reprise du momentum, signal d'achat classique.`; }
    else if (wasHigh && v > 50) { sig = "baissier"; txt = `RSI à ${num(v, 0)}, il redescend de la zone de surachat des jours précédents : essoufflement, signal de vente classique.`; }
    else txt = `RSI à ${num(v, 0)} : zone neutre (entre 30 et 70)${v >= 50 ? ", momentum légèrement haussier" : ", momentum légèrement baissier"}. Pas de signal net.`;
    add("rsi", "Le RSI", num(v, 0), txt, sig);
  }

  // 02 Moyennes mobiles
  {
    const a = s20[i]!, b = s50[i]!, d = s200[i];
    let sig: Signal = "neutre", txt: string;
    let cross: string | null = null;
    if (d != null) for (let k = i; k > i - 20 && k > 0; k--) {
      if (s50[k] != null && s200[k] != null && s50[k - 1] != null && s200[k - 1] != null) {
        if (s50[k - 1]! <= s200[k - 1]! && s50[k]! > s200[k]!) { cross = `croisement haussier MM50/MM200 (« golden cross ») il y a ${i - k} séance(s)`; break; }
        if (s50[k - 1]! >= s200[k - 1]! && s50[k]! < s200[k]!) { cross = `croisement baissier MM50/MM200 (« death cross ») il y a ${i - k} séance(s)`; break; }
      }
    }
    const pos = `Cours ${usd(c)} ; MM20 ${usd(a)}, MM50 ${usd(b)}${d != null ? `, MM200 ${usd(d)}` : ""}`;
    if (cross?.includes("haussier")) { sig = "haussier"; txt = `${pos}. ${cross[0].toUpperCase()}${cross.slice(1)} : signal d'entrée en tendance haussière.`; }
    else if (cross?.includes("baissier")) { sig = "baissier"; txt = `${pos}. ${cross[0].toUpperCase()}${cross.slice(1)} : signal de dégradation de tendance.`; }
    else if (c > b && (d == null || b > d) && c > a) { sig = "haussier"; txt = `${pos}. Le cours est au-dessus de ses moyennes, elles-mêmes bien ordonnées : tendance haussière installée.`; }
    else if (c < b && (d == null || b < d) && c < a) { sig = "baissier"; txt = `${pos}. Le cours est sous ses moyennes, orientées à la baisse : tendance baissière installée.`; }
    else txt = `${pos}. Moyennes croisées, sans tendance claire.`;
    add("mm", "Les moyennes mobiles", c > b ? "au-dessus MM50" : "sous MM50", txt, sig);
  }

  // 03 MACD
  {
    const L = m.line[i]!, S = m.signal[i]!, H = m.hist[i]!, Hp = at(m.hist, i - 3);
    let crossAgo: number | null = null, crossUp = false;
    for (let k = i; k > i - 6 && k > 0; k--) {
      const h0 = m.hist[k], h1 = m.hist[k - 1];
      if (h0 != null && h1 != null && Math.sign(h0) !== Math.sign(h1)) { crossAgo = i - k; crossUp = h0 > 0; break; }
    }
    const zone = L > 0 ? "au-dessus de zéro (tendance de fond haussière)" : "sous zéro (tendance de fond baissière)";
    let sig: Signal, txt: string;
    if (crossAgo != null) {
      sig = crossUp ? "haussier" : "baissier";
      txt = `Le MACD vient de croiser sa ligne de signal ${crossUp ? "à la hausse" : "à la baisse"} il y a ${crossAgo} séance(s), ${zone} : signal ${crossUp ? "d'achat" : "de vente"} classique.`;
    } else if (L > S) {
      sig = "haussier";
      txt = `MACD au-dessus de sa ligne de signal, ${zone}${Hp != null && H < Hp ? ", mais l'histogramme se réduit (élan qui faiblit)" : ", histogramme en progression"}.`;
    } else {
      sig = "baissier";
      txt = `MACD sous sa ligne de signal, ${zone}${Hp != null && H > Hp ? ", mais l'histogramme se resserre (pression vendeuse qui faiblit)" : ", histogramme qui se creuse"}.`;
    }
    add("macd", "Le MACD", `${num(L)} / ${num(S)}`, txt, sig);
  }

  // 04 Bandes de Bollinger
  {
    const p = bb.pctB[i]!, w = bb.width[i]!;
    const widths = bb.width.slice(Math.max(0, i - 120), i + 1).filter((x): x is number => x != null).sort((a, b) => a - b);
    const squeeze = widths.length > 40 && w <= widths[Math.floor(widths.length * 0.2)];
    let sig: Signal = "neutre", txt: string;
    const val = `bande basse ${usd(bb.lower[i]!)}, haute ${usd(bb.upper[i]!)}`;
    if (p < 0) { sig = "haussier"; txt = `Cours sous la bande basse (${val}) : écart excessif à la moyenne, retour vers le milieu probable — zone d'achat classique.`; }
    else if (p <= 0.15) { sig = "haussier"; txt = `Cours collé à la bande basse (${val}) : zone d'achat classique.`; }
    else if (p > 1) { sig = "baissier"; txt = `Cours au-dessus de la bande haute (${val}) : extension excessive — zone de prise de bénéfices.`; }
    else if (p >= 0.85) { sig = "baissier"; txt = `Cours collé à la bande haute (${val}) : zone de vente classique (sauf forte tendance).`; }
    else txt = `Cours à l'intérieur des bandes (${val}), sans excès.`;
    if (squeeze) txt += " Les bandes sont resserrées : un mouvement fort se prépare souvent.";
    add("bollinger", "Les bandes de Bollinger", `%B ${num(p * 100, 0)} %`, txt, sig);
  }

  // 05 Volume
  {
    const avg = vol.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    const ratio = avg ? vol[i] / avg : 1;
    const day = close[i] / close[i - 1] - 1;
    let up = 0, down = 0;
    for (let k = i - 19; k <= i; k++) (close[k] >= close[k - 1] ? (up += vol[k]) : (down += vol[k]));
    let sig: Signal = "neutre", txt: string;
    if (ratio >= 1.5) {
      sig = day >= 0 ? "haussier" : "baissier";
      txt = `Volume ${num(ratio, 1)} fois supérieur à la moyenne de 20 jours, séance ${pct(day)} : ${day >= 0 ? "forte demande, la hausse est confirmée par les volumes" : "forte pression vendeuse confirmée par les volumes"}.`;
    } else if (up > 1.25 * down) { sig = "haussier"; txt = `Volume de la séance : ${num(ratio, 1)}× la moyenne. Sur 20 jours, les volumes sont plus forts les jours de hausse : accumulation par les acheteurs.`; }
    else if (down > 1.25 * up) { sig = "baissier"; txt = `Volume de la séance : ${num(ratio, 1)}× la moyenne. Sur 20 jours, les volumes sont plus forts les jours de baisse : distribution par les vendeurs.`; }
    else txt = `Volume ${num(ratio, 1)}× la moyenne de 20 jours, équilibré entre jours de hausse et de baisse : pas de signal.`;
    add("volume", "Le volume", `${num(ratio, 1)}× moy.`, txt, sig);
  }

  // 06 Supports et résistances
  const start = Math.max(0, i - 120);
  const win = bars.slice(start, i + 1);
  const pv = pivots(win, 5);
  const levels = clusterLevels([...pv.highs.map((x) => x.price), ...pv.lows.map((x) => x.price)]);
  const support = levels.filter((l) => l.price < c).sort((a, b) => b.price - a.price)[0] ?? null;
  const resistance = levels.filter((l) => l.price > c).sort((a, b) => a.price - b.price)[0] ?? null;
  {
    const prevHigh = Math.max(...bars.slice(Math.max(0, i - 60), i - 3).map((b) => b.high));
    const prevLow = Math.min(...bars.slice(Math.max(0, i - 60), i - 3).map((b) => b.low));
    const dS = support ? (c - support.price) / c : Infinity, dR = resistance ? (resistance.price - c) / c : Infinity;
    let sig: Signal = "neutre", txt: string;
    if (c > prevHigh) { sig = "haussier"; txt = `Le cours (${usd(c)}) vient de casser son plus haut de 3 mois (${usd(prevHigh)}) : cassure de résistance, signal d'achat de tendance.`; }
    else if (c < prevLow) { sig = "baissier"; txt = `Le cours (${usd(c)}) vient de casser son plus bas de 3 mois (${usd(prevLow)}) : cassure de support, signal de vente.`; }
    else if (dS <= 0.03 && dS <= dR && support!.touches >= 2) { sig = "haussier"; txt = `Le cours (${usd(c)}) est à ${pct(-dS)} d'un support à ${usd(support!.price)} (touché ${support!.touches} fois) : zone où les acheteurs sont déjà intervenus.`; }
    else if (dR <= 0.03 && resistance!.touches >= 2) { sig = "baissier"; txt = `Le cours (${usd(c)}) bute sur une résistance à ${usd(resistance!.price)} (${pct(dR)}, touchée ${resistance!.touches} fois) : zone où les vendeurs sont déjà intervenus.`; }
    else if (dS <= 0.03 || dR <= 0.03) txt = `Le cours (${usd(c)}) est proche d'un ancien ${dS <= dR ? `plus bas à ${usd(support!.price)}` : `plus haut à ${usd(resistance!.price)}`}, touché une seule fois : niveau trop peu testé pour faire un vrai ${dS <= dR ? "support" : "résistance"}.`;
    else txt = `Le cours (${usd(c)}) est entre un support à ${support ? usd(support.price) : "—"} et une résistance à ${resistance ? usd(resistance.price) : "—"}, loin des deux.`;
    add("sr", "Supports et résistances", support && resistance ? `${usd(support.price)} / ${usd(resistance.price)}` : "—", txt, sig);
  }

  // 07 Fibonacci (dernière grande oscillation sur 6 mois)
  let fib: ChartData["fib"] = [], fibTrend: ChartData["fibTrend"] = null;
  {
    let hiI = start, loI = start;
    for (let k = start; k <= i; k++) { if (bars[k].high > bars[hiI].high) hiI = k; if (bars[k].low < bars[loI].low) loI = k; }
    const hi = bars[hiI].high, lo = bars[loI].low, span = hi - lo;
    let sig: Signal = "neutre", txt: string, valeur = "—";
    if (span > 0) {
      if (loI < hiI) {
        fibTrend = "hausse";
        fib = FIB_RATIOS.map((ratio) => ({ ratio, price: hi - ratio * span }));
        const retr = (hi - c) / span;
        valeur = `repli ${num(retr * 100, 0)} %`;
        if (retr >= 0.382 && retr <= 0.618) { sig = "haussier"; txt = `Après la hausse de ${usd(lo)} à ${usd(hi)}, le cours a corrigé de ${num(retr * 100, 0)} % : il est dans la zone 38,2–61,8 %, où les replis s'arrêtent le plus souvent — zone d'achat classique.`; }
        else if (retr < 0.236) { sig = "baissier"; txt = `Le cours est proche du sommet de sa hausse (${usd(hi)}, repli de seulement ${num(retr * 100, 0)} %) : peu de marge avant résistance, zone de prise de bénéfices.`; }
        else if (retr > 0.786) { sig = "baissier"; txt = `Le repli dépasse 78,6 % de la hausse de ${usd(lo)} à ${usd(hi)} : la tendance haussière est remise en cause.`; }
        else txt = `Repli de ${num(retr * 100, 0)} % de la hausse de ${usd(lo)} à ${usd(hi)} : entre deux niveaux de Fibonacci, pas de signal net.`;
      } else {
        fibTrend = "baisse";
        fib = FIB_RATIOS.map((ratio) => ({ ratio, price: lo + ratio * span }));
        const reb = (c - lo) / span;
        valeur = `rebond ${num(reb * 100, 0)} %`;
        if (reb >= 0.382 && reb <= 0.618) { sig = "baissier"; txt = `Après la baisse de ${usd(hi)} à ${usd(lo)}, le cours a repris ${num(reb * 100, 0)} % : il est dans la zone 38,2–61,8 % où les rebonds échouent souvent — zone de vente classique.`; }
        else if (reb > 0.786) { sig = "haussier"; txt = `Le cours a effacé plus de 78,6 % de sa baisse : retournement de tendance probable.`; }
        else if (reb < 0.236) { sig = "neutre"; txt = `Le cours est proche de son plus bas (${usd(lo)}) : la baisse n'a pas encore été corrigée, ni signal d'achat ni de vente selon Fibonacci.`; }
        else txt = `Rebond de ${num(reb * 100, 0)} % de la baisse de ${usd(hi)} à ${usd(lo)} : entre deux niveaux, pas de signal net.`;
      }
    } else txt = "Amplitude nulle sur la période.";
    add("fibo", "Fibonacci", valeur, txt, sig);
  }

  // 08 Stochastique
  {
    const K = st.k[i]!, D = st.d[i]!, Kp = at(st.k, i - 1), Dp = at(st.d, i - 1);
    const crossUp = Kp != null && Dp != null && Kp <= Dp && K > D, crossDown = Kp != null && Dp != null && Kp >= Dp && K < D;
    let sig: Signal = "neutre", txt: string;
    if (K < 20) { sig = "haussier"; txt = `%K à ${num(K, 0)} (sous 20) : survente${crossUp ? ", et %K repasse au-dessus de %D : signal d'achat confirmé" : K > D ? ", %K au-dessus de %D : début de retournement" : ""}.`; }
    else if (K > 80) { sig = "baissier"; txt = `%K à ${num(K, 0)} (au-dessus de 80) : surachat${crossDown ? ", et %K repasse sous %D : signal de vente confirmé" : K < D ? ", %K sous %D : début de retournement" : ""}.`; }
    else if (crossUp && K < 50) { sig = "haussier"; txt = `%K (${num(K, 0)}) croise %D à la hausse en zone basse : signal d'achat.`; }
    else if (crossDown && K > 50) { sig = "baissier"; txt = `%K (${num(K, 0)}) croise %D à la baisse en zone haute : signal de vente.`; }
    else txt = `%K à ${num(K, 0)}, %D à ${num(D, 0)} : zone intermédiaire, pas de signal.`;
    add("stoch", "Le stochastique", `%K ${num(K, 0)} · %D ${num(D, 0)}`, txt, sig);
  }

  const pour = readings.filter((x) => x.accord === "pour").length;
  const contre = readings.filter((x) => x.accord === "contre").length;
  const neutres = readings.length - pour - contre;
  const verbe = t.sens === "achat" ? "l'achat" : "la vente";
  let verdict: Analysis["verdict"];
  if (pour - contre >= 3) verdict = { ton: "coherent", titre: `Signal technique cohérent avec ${verbe}`, texte: `${pour} indicateurs sur 8 allaient dans le sens de ${verbe}, ${contre} contre. Le timing correspond à une lecture technique classique.` };
  else if (contre - pour >= 3) verdict = { ton: "contre", titre: `${t.sens === "achat" ? "Achat" : "Vente"} à contre-courant technique`, texte: `${contre} indicateurs sur 8 suggéraient l'inverse, ${pour} seulement allaient dans ce sens. La décision s'explique plutôt par des raisons de fond ou personnelles (voir le motif) que par le graphique${t.sens === "achat" ? " — ou par une logique « contrarienne » d'achat dans la faiblesse" : ""}.` };
  else verdict = { ton: "mitige", titre: "Signaux techniques mitigés", texte: `${pour} indicateurs pour, ${contre} contre, ${neutres} neutres : le graphique ne donnait pas de signal clair au moment de ${verbe}.` };

  const suite = [5, 20, 60].flatMap((n) => (i + n < bars.length ? [{ jours: n, date: bars[i + n].date, perf: close[i + n] / c - 1 }] : []));

  let periode: Analysis["periode"];
  let periodStart: number | undefined;
  if (q) {
    const qs = `${q[2]}-${QUARTER_START[q[1]]}`;
    const a = bars.findIndex((b) => b.date >= qs);
    if (a >= 0 && a <= i) {
      const seg = close.slice(a, i + 1);
      periode = { debut: bars[a].date, fin: bars[i].date, perf: c / close[Math.max(0, a - 1)] - 1, min: Math.min(...seg), max: Math.max(...seg) };
      periodStart = a;
    }
  }

  // Fenêtre des graphiques : 120 séances avant, 40 après
  const a0 = Math.max(0, i - 120), a1 = Math.min(bars.length, i + 41);
  const sl = <T,>(s: T[]) => s.slice(a0, a1);
  const chart: ChartData = {
    dates: sl(bars.map((b) => b.date)), close: sl(close), volume: sl(vol), refIndex: i - a0,
    sma20: sl(s20), sma50: sl(s50), sma200: sl(s200), rsi: sl(r), macd: sl(m.line), macdSignal: sl(m.signal), macdHist: sl(m.hist),
    bbUpper: sl(bb.upper), bbMid: sl(bb.mid), bbLower: sl(bb.lower), stochK: sl(st.k), stochD: sl(st.d),
    support: support?.price ?? null, resistance: resistance?.price ?? null, levels, fib, fibTrend,
    periodStart: periodStart != null ? Math.max(0, periodStart - a0) : undefined,
  };

  return { statut: "ok", refDate: bars[i].date, close: c, readings, pour, contre, neutres, verdict, motif: motifOf(t), suite, periode, chart };
}

/** Raison probable, indépendante du graphique, déduite du type d'opération déclarée. */
export function motifOf(t: TradeInput): { titre: string; texte: string } {
  const op = t.operation.toLowerCase();
  if (t.source === "FORM4") {
    if (op.startsWith("achat")) return { titre: "Achat sur le marché par un initié", texte: "Un dirigeant ou administrateur achète avec son propre argent, au prix du marché. C'est le signal d'initié le plus étudié : les initiés vendent pour mille raisons (impôts, diversification, achat immobilier) mais n'achètent que pour une seule — ils pensent que l'action va monter." };
    if (op.includes("après exercice")) return { titre: "Vente liée à la rémunération", texte: "L'initié exerce des options reçues en rémunération puis revend tout ou partie des actions, souvent dans le cadre d'un plan de cession programmé à l'avance (règle 10b5-1). Ce type de vente dit peu de chose sur son opinion du titre." };
    if (op.startsWith("retenue")) return { titre: "Retenue fiscale ou paiement d'exercice", texte: "Des actions sont remises à la société pour payer l'impôt ou le prix d'exercice d'options. Ce n'est pas une décision de marché." };
    if (op.startsWith("vente")) return { titre: "Vente sur le marché par un initié", texte: "Les ventes d'initiés ont des motifs variés (diversification, impôts, besoins personnels, plan 10b5-1 programmé). Elles sont un signal faible, sauf si plusieurs dirigeants vendent en même temps ou si la vente est inhabituellement grosse." };
    if (op.includes("attribution") || op.includes("réception")) return { titre: "Attribution d'actions", texte: "Actions reçues en rémunération ou lors d'une opération sur le capital, sans décision d'achat sur le marché." };
    if (op.includes("exercice")) return { titre: "Exercice d'options", texte: "Conversion d'options en actions, généralement à l'approche de leur échéance ; ce n'est pas un achat sur le marché." };
    if (op.includes("don")) return { titre: "Don", texte: "Actions données (souvent à une fondation), pour des raisons philanthropiques ou fiscales." };
    return { titre: "Opération sur le capital", texte: "Opération technique (conversion, annulation, renonciation) sans lien avec une décision de marché." };
  }
  if (t.source === "13F") return { titre: `Choix de gérant sur le trimestre (${t.trimestre ?? ""})`, texte: "Le 13F montre seulement la variation du nombre d'actions entre deux fins de trimestre : la ou les dates d'achat ou de vente sont inconnues. Les grands gérants raisonnent en années (valorisation, perspectives, pondération du portefeuille) plus qu'en signaux de court terme. Les indicateurs sont calculés au dernier jour du trimestre." };
  if (t.source === "ARK") return { titre: "Gestion active d'ARK", texte: "ARK achète souvent ses valeurs de conviction dans les baisses et vend celles qui ont fortement monté pour rééquilibrer le poids de chaque ligne dans ses ETF. Les opérations répondent aussi aux entrées et sorties d'argent des fonds." };
  if (t.source === "TRUMP") return { titre: "Portefeuille géré", texte: "Les déclarations de Donald Trump comptent des milliers de petites transactions par mois : un tel volume correspond en général à une gestion déléguée à des gérants, plutôt qu'à des décisions individuelles. Montants en fourchettes légales." };
  if (t.source === "CONGRES") return { titre: "Déclaration d'élu (STOCK Act)", texte: "Les transactions d'élus peuvent être faites par l'élu, son conjoint ou un gérant. La déclaration peut arriver jusqu'à 45 jours après l'opération ; le montant est une fourchette." };
  return { titre: "", texte: "" };
}
