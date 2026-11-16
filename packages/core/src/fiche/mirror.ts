import type { Bar } from "../ta/indicators";
import { acteurOf, isCompensation, type OpLite } from "./fiche";

/**
 * Portefeuille miroir : que serait devenu un suiveur qui copie chaque achat d'un investisseur
 * au moment où il est PUBLIÉ (clôture de la première séance après la publication), et revend
 * quand l'investisseur publie sa vente (sinon : position gardée jusqu'au dernier cours connu).
 * Même montant par achat ; comparaison avec les mêmes montants placés sur le S&P 500 (SPY) aux mêmes dates.
 */

export interface MirrorOp extends OpLite { ticker: string; societe?: string | null }
export interface MirrorTrade {
  ticker: string; societe: string | null; operation: string; datePublication: string; dateOperation: string | null;
  entree: { date: string; prix: number }; sortie: { date: string; prix: number; raison: "vente" | "en cours" };
  perf: number; perfSpy: number | null; excedent: number | null;
  /** Même position mais entrée au jour de l'opération : ce que le délai de publication a coûté. */
  perfSansRetard: number | null;
  perf20: number | null; perf60: number | null;
}
export interface MirrorResult {
  acteur: string; source: string; signaux: number; couverts: number;
  trades: MirrorTrade[];
  gainMoyen: number | null; excedentMoyen: number | null; reussite: number | null; perf20: number | null; perf60: number | null;
  coutRetard: number | null;
  portefeuille: { investi: number; valeur: number; gainPct: number; valeurSpy: number | null; gainSpyPct: number | null } | null;
  courbe: { date: string; miroir: number; spy: number | null }[];
}

const MISE = 1000;
const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
/** Premier indice de séance strictement après `date` (ou ≥ si `inclusive`). */
function firstAfter(bars: Bar[], date: string, inclusive = false): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (inclusive ? bars[m].date >= date : bars[m].date > date) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans;
}
function atOrBefore(bars: Bar[], date: string): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

export const isMirrorBuy = (o: OpLite) => o.sens === "achat" && !isCompensation(o);
export const isMirrorSell = (o: OpLite) => o.sens === "vente" && !isCompensation(o);

export function mirrorFor(acteur: string, ops: MirrorOp[], barsOf: (t: string) => Bar[], spy: Bar[], opts: { courbe?: boolean } = {}): MirrorResult {
  const mine = ops.filter((o) => acteurOf(o) === acteur).sort((a, b) => a.datePublication.localeCompare(b.datePublication));
  const buys = mine.filter(isMirrorBuy);
  const trades: MirrorTrade[] = [];
  for (const b of buys) {
    const bars = barsOf(b.ticker);
    const ie = firstAfter(bars, b.datePublication);
    if (ie < 0) continue; // publication trop récente ou cours indisponibles
    // Sortie : première vente publiée ensuite par le même investisseur sur la même action
    const sell = mine.find((o) => o.ticker === b.ticker && isMirrorSell(o) && o.datePublication >= b.datePublication && (o.dateOperation ?? o.datePublication) >= (b.dateOperation ?? b.datePublication) && o !== b);
    let ix = bars.length - 1, raison: "vente" | "en cours" = "en cours";
    if (sell) { const k = firstAfter(bars, sell.datePublication); if (k >= 0) { ix = k; raison = "vente"; } }
    if (ix < ie) continue;
    const pIn = bars[ie].close, pOut = bars[ix].close;
    const si = spy.length ? firstAfter(spy, b.datePublication) : -1, so = spy.length ? atOrBefore(spy, bars[ix].date) : -1;
    const perfSpy = si >= 0 && so >= si ? spy[so].close / spy[si].close - 1 : null;
    const io = b.dateOperation && !b.trimestre ? atOrBefore(bars, b.dateOperation) : -1;
    const perf = pOut / pIn - 1;
    trades.push({
      ticker: b.ticker, societe: b.societe ?? null, operation: b.operation, datePublication: b.datePublication, dateOperation: b.dateOperation,
      entree: { date: bars[ie].date, prix: pIn }, sortie: { date: bars[ix].date, prix: pOut, raison },
      perf, perfSpy, excedent: perfSpy != null ? perf - perfSpy : null,
      perfSansRetard: io >= 0 && io < ie ? pOut / bars[io].close - 1 : null,
      perf20: ie + 20 < bars.length ? bars[ie + 20].close / pIn - 1 : null,
      perf60: ie + 60 < bars.length ? bars[ie + 60].close / pIn - 1 : null,
    });
  }
  const perfs = trades.map((t) => t.perf);
  const exc = trades.flatMap((t) => (t.excedent != null ? [t.excedent] : []));
  const retard = trades.flatMap((t) => (t.perfSansRetard != null ? [t.perfSansRetard - t.perf] : []));
  const investi = trades.length * MISE;
  const valeur = trades.reduce((a, t) => a + MISE * (1 + t.perf), 0);
  const spyTrades = trades.filter((t) => t.perfSpy != null);
  const valeurSpy = spyTrades.length === trades.length ? trades.reduce((a, t) => a + MISE * (1 + (t.perfSpy ?? 0)), 0) : null;

  // Courbe : valeur du portefeuille miroir et de son équivalent S&P 500, séance par séance (une séance sur 3)
  const courbe: MirrorResult["courbe"] = [];
  if (opts.courbe && trades.length && spy.length) {
    const start = trades.reduce((m, t) => (t.entree.date < m ? t.entree.date : m), "9999");
    const i0 = firstAfter(spy, start, true);
    const series = trades.map((t) => ({ t, bars: barsOf(t.ticker) }));
    for (let i = Math.max(0, i0); i < spy.length; i += 3) {
      const d = spy[i].date;
      let inv = 0, val = 0, valS = 0;
      for (const { t, bars } of series) {
        if (t.entree.date > d) continue;
        inv += MISE;
        const k = atOrBefore(bars, d < t.sortie.date ? d : t.sortie.date);
        val += MISE * (bars[k].close / t.entree.prix);
        const sIn = spy[firstAfter(spy, t.datePublication)], sNow = spy[atOrBefore(spy, d < t.sortie.date ? d : t.sortie.date)];
        valS += sIn && sNow ? MISE * (sNow.close / sIn.close) : MISE;
      }
      if (inv) courbe.push({ date: d, miroir: val / inv - 1, spy: valS / inv - 1 });
    }
  }
  return {
    acteur, source: mine[0]?.source ?? "", signaux: buys.length, couverts: trades.length, trades,
    gainMoyen: avg(perfs), excedentMoyen: avg(exc), reussite: trades.length ? perfs.filter((x) => x > 0).length / trades.length : null,
    perf20: avg(trades.flatMap((t) => (t.perf20 != null ? [t.perf20] : []))), perf60: avg(trades.flatMap((t) => (t.perf60 != null ? [t.perf60] : []))),
    coutRetard: avg(retard),
    portefeuille: trades.length ? { investi, valeur, gainPct: valeur / investi - 1, valeurSpy, gainSpyPct: valeurSpy != null ? valeurSpy / investi - 1 : null } : null,
    courbe,
  };
}
