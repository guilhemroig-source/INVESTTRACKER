import { sql } from "drizzle-orm";
import type { Db } from "./db/client";
import type { Bar } from "./ta";
import { barsOf } from "./analysis-store";
import { acteurOf } from "./fiche";
import { type ClassementRow, getClassement } from "./fiche-store";
import { getPortfolio, lastPrice, listJournal } from "./portfolio-store";
import { listWatch } from "./watch-store";
import { type EvenementVue, getCalendrier } from "./calendrier-store";

/** Cours d'une action pour l'aperçu : dernier cours, variations 1 jour / 1 mois, courbe de 3 mois. */
export interface Cotation { cours: number | null; date: string | null; var1j: number | null; var1m: number | null; spark: number[]; devise?: string }
export interface ApercuItem {
  ticker: string; societe: string | null; cot: Cotation;
  score?: number; acheteurs?: string[]; vendeurs?: string[]; derniere?: string; retard?: number | null;
  gainPct?: number | null; poids?: number | null; alertes?: string[];
}
export interface Apercu {
  date: string;
  aSuivre: ApercuItem[];
  pression: ApercuItem[];
  actifs: {
    source: "portefeuille" | "liste" | "aucun"; items: ApercuItem[];
    total: { valeur: number; devise: string; gainTotalPct: number | null; reference: string | null; referencePct: number | null } | null;
  };
  /** Prochains événements : résultats de mes actions et de celles des investisseurs, Fed, échéances */
  agenda: EvenementVue[];
  semaine: {
    achats: number; ventes: number; acteurs: number; dernierePublication: string | null;
    plusAchetee: { ticker: string; acteurs: number } | null; plusVendue: { ticker: string; acteurs: number } | null;
    aRevoir: number; alertesPortefeuille: number;
  };
}

/** Variations calculées sur les cours ajustés ; le cours affiché est le cours réel (non ajusté) quand il existe. */
export function cotationFrom(bars: Pick<Bar, "date" | "close">[], brut?: { cours: number; date: string } | null): Cotation {
  if (!bars.length) return { cours: brut?.cours ?? null, date: brut?.date ?? null, var1j: null, var1m: null, spark: [] };
  const n = bars.length, last = bars[n - 1].close;
  const v = (k: number) => (n > k && bars[n - 1 - k].close > 0 ? last / bars[n - 1 - k].close - 1 : null);
  const win = bars.slice(-63).map((b) => b.close);
  const step = Math.max(1, Math.ceil(win.length / 42));
  const spark = win.filter((_, i) => i % step === 0 || i === win.length - 1).map((x) => Math.round(x * 100) / 100);
  return { cours: brut?.cours ?? last, date: brut?.date ?? bars[n - 1].date, var1j: v(1), var1m: v(21), spark };
}

const EXCLUS = sql`NOT (source = 'FORM4' AND (operation LIKE '%exercice%' OR operation LIKE 'Retenue%' OR operation LIKE 'Don%'))`;

/** Sélection « à suivre » : achats convergents des investisseurs suivis, plus d'acheteurs que de vendeurs. */
export function selectASuivre(rows: ClassementRow[], n = 6): ClassementRow[] {
  return rows.filter((r) => r.score > 0 && r.acheteurs.length > 0 && r.acheteurs.length > r.vendeurs.length).slice(0, n);
}
/** Sélection « sous pression » : au moins deux vendeurs distincts, plus nombreux que les acheteurs. */
export function selectPression(rows: ClassementRow[], n = 5): ClassementRow[] {
  return rows.filter((r) => r.vendeurs.length >= 2 && r.vendeurs.length > r.acheteurs.length)
    .sort((a, b) => b.vendeurs.length - a.vendeurs.length || b.derniere.localeCompare(a.derniere)).slice(0, n);
}

/** Vue d'ensemble affichée en haut du tableau de bord. */
export function getApercu(db: Db, today: string, classement: ClassementRow[] = getClassement(db, today)): Apercu {
  const cot = (t: string) => cotationFrom(barsOf(db, t), lastPrice(db, t));
  const item = (r: ClassementRow): ApercuItem => ({
    ticker: r.ticker, societe: r.societe, cot: cot(r.ticker), score: r.score, acheteurs: r.acheteurs, vendeurs: r.vendeurs, derniere: r.derniere, retard: r.retard,
  });
  const nom = (t: string) => classement.find((r) => r.ticker === t)?.societe
    ?? db.get<{ n: string | null }>(sql`SELECT nom n FROM tickers WHERE ticker = ${t}`)?.n ?? null;

  // Mes actifs : le portefeuille s'il existe, sinon les actions de la liste de suivi
  let actifs: Apercu["actifs"] = { source: "aucun", items: [], total: null };
  const pf = getPortfolio(db, today);
  const pos = pf.positions.filter((p) => p.quantite > 0).sort((a, b) => (b.valeur ?? 0) - (a.valeur ?? 0));
  if (pos.length) {
    actifs = {
      source: "portefeuille",
      items: pos.slice(0, 6).map((p) => {
        // Variation et courbe : celles de l'actif coté, ou de l'indice qui prolonge un cours saisi ; cours dans la devise du portefeuille
        const q = pf.cotes[p.ticker];
        const base = cotationFrom(q?.source === "manuel" ? [] : barsOf(db, q?.indice ?? p.ticker));
        return { ticker: p.ticker, societe: pf.societes[p.ticker] ?? nom(p.ticker), cot: { ...base, cours: p.cours, date: p.dateCours, devise: pf.devise }, gainPct: p.gainLatentPct, poids: p.poids, alertes: p.alertes };
      }),
      total: { valeur: pf.totaux.valeur, devise: pf.devise, gainTotalPct: pf.totaux.gainTotalPct, reference: pf.reference?.ticker ?? null, referencePct: pf.reference?.gainTotalPct ?? null },
    };
  } else {
    const suivies = [...new Set(listWatch(db).filter((w) => w.type === "action").map((w) => w.valeur))];
    if (suivies.length) actifs = { source: "liste", items: suivies.slice(0, 6).map((t) => ({ ticker: t, societe: nom(t), cot: cot(t) })), total: null };
  }

  // La semaine : opérations publiées ces 7 derniers jours
  const since = new Date(Date.parse(today) - 7 * 86400_000).toISOString().slice(0, 10);
  const ops = db.all<{ ticker: string; sens: string; source: string; qui: string; date_publication: string }>(sql`
    SELECT ticker, sens, source, qui, date_publication FROM operations WHERE date_publication >= ${since} AND ${EXCLUS}`);
  const top = (sens: string) => {
    const m = new Map<string, Set<string>>();
    for (const o of ops.filter((x) => x.sens === sens)) (m.get(o.ticker) ?? m.set(o.ticker, new Set()).get(o.ticker)!).add(acteurOf(o));
    const best = [...m].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
    return best ? { ticker: best[0], acteurs: best[1].size } : null;
  };
  const journal = listJournal(db, today);

  return {
    date: today,
    aSuivre: selectASuivre(classement).map(item),
    pression: selectPression(classement).map(item),
    actifs,
    agenda: (() => {
      const l = getCalendrier(db, today, 21).evenements.filter((e) => !e.passe && e.type !== "nouvelle");
      // Mes actions d'abord, puis les plus traitées par les investisseurs, dans l'ordre des dates
      const choix = new Set([...l.filter((e) => e.mien || e.type !== "resultats"), ...[...l].sort((a, b) => (b.acheteurs.length + b.vendeurs.length) - (a.acheteurs.length + a.vendeurs.length))].slice(0, 7));
      return l.filter((e) => choix.has(e));
    })(),
    semaine: {
      achats: ops.filter((o) => o.sens === "achat").length, ventes: ops.filter((o) => o.sens !== "achat").length,
      acteurs: new Set(ops.map(acteurOf)).size,
      dernierePublication: db.get<{ d: string | null }>(sql`SELECT MAX(date_publication) d FROM operations`)?.d ?? null,
      plusAchetee: top("achat"), plusVendue: top("vente"),
      aRevoir: journal.stats.aRevoir, alertesPortefeuille: pos.reduce((n, p) => n + p.alertes.length, 0),
    },
  };
}
