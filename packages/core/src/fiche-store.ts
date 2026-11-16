import { desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import { barsOf } from "./analysis-store";
import { type Fiche, type MirrorOp, type MirrorResult, type OpLite, type TrackRecord, acteurOf, finances, isCompensation, isMirrorBuy, mirrorFor, risque, smartMoney } from "./fiche";

/** Historique de réussite : évolution moyenne du cours 20 et 60 séances après les achats de chaque investisseur. */
export function trackRecords(db: Db): Map<string, TrackRecord> {
  const rows = db.all<{ source: string; qui: string; operation: string; perf20: number | null; perf60: number | null }>(sql`
    SELECT o.source, o.qui, o.operation, a.perf20, a.perf60 FROM operations o JOIN analyses a ON a.cle_unique = o.cle_unique
    WHERE o.sens = 'achat' AND a.statut = 'ok' AND a.perf20 IS NOT NULL`);
  const m = new Map<string, { p20: number[]; p60: number[] }>();
  for (const r of rows) {
    if (isCompensation(r)) continue;
    const k = acteurOf(r);
    const e = m.get(k) ?? { p20: [], p60: [] };
    e.p20.push(r.perf20!); if (r.perf60 != null) e.p60.push(r.perf60);
    m.set(k, e);
  }
  const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
  return new Map([...m.entries()].map(([acteur, e]) => [acteur, { acteur, n: e.p20.length, perf20: avg(e.p20), perf60: avg(e.p60), reussite: e.p20.filter((x) => x > 0).length / e.p20.length }]));
}

function opsOf(db: Db, ticker: string): OpLite[] {
  return db.all<OpLite>(sql`
    SELECT o.source, o.sens, o.qui, o.operation, o.date_publication AS datePublication, o.date_operation AS dateOperation, o.montant_usd AS montantUsd,
           r.trimestre AS trimestre, r.poids_pct AS poidsPct, r.rang AS rang
    FROM operations o LEFT JOIN raw_13f r ON r.cle_unique = o.cle_unique WHERE o.ticker = ${ticker}`);
}

/** Fiche d'une action : signaux des investisseurs suivis, risque et marché, valorisation et santé financière. */
export function getFiche(db: Db, ticker: string, today: string, track = trackRecords(db)): Fiche {
  const bars = barsOf(db, ticker);
  const brut = db.select({ c: s.prices.closeBrut }).from(s.prices).where(eq(s.prices.ticker, ticker)).orderBy(desc(s.prices.date)).limit(1).get()?.c ?? null;
  const r = risque(bars, barsOf(db, "SPY"), barsOf(db, "QQQ"), brut);
  const f = db.select().from(s.fundamentals).where(eq(s.fundamentals.ticker, ticker)).get();
  return {
    ticker,
    smart: smartMoney(opsOf(db, ticker), bars, today, track),
    risque: r,
    finances: f?.statut === "ok" ? finances(f, r.cours) : null,
    financesStatut: !f ? "Comptes pas encore collectés (collecteur « fondamentaux »)." : f.statut === "ok" ? "" : f.erreur ?? "Comptes indisponibles (société étrangère ou fonds).",
  };
}

export interface ClassementRow {
  ticker: string; societe: string | null; score: number; acheteurs: string[]; vendeurs: string[]; initiesAchat: number;
  derniere: string; retard: number | null; per: number | null; croissanceCa: number | null; margeNette: number | null;
  detteSurFp: number | null; volatilite: number | null; force6m: number | null; scoreDetail: string[];
}

/** Classement des actions traitées par les investisseurs suivis ces 90 derniers jours. */
export function getClassement(db: Db, today: string): ClassementRow[] {
  const since = new Date(Date.parse(today) - 90 * 86400_000).toISOString().slice(0, 10);
  const tickers = db.all<{ ticker: string; societe: string | null; derniere: string }>(sql`
    SELECT o.ticker, COALESCE(MAX(o.societe), t.nom) AS societe, MAX(o.date_publication) AS derniere
    FROM operations o LEFT JOIN tickers t ON t.ticker = o.ticker
    WHERE o.date_publication >= ${since} GROUP BY o.ticker`);
  const track = trackRecords(db);
  return tickers.map((t) => {
    const f = getFiche(db, t.ticker, today, track);
    return {
      ticker: t.ticker, societe: t.societe, score: f.smart.score, acheteurs: f.smart.acheteurs.map((a) => a.acteur), vendeurs: f.smart.vendeurs.map((a) => a.acteur),
      initiesAchat: f.smart.achatsInities.n, derniere: t.derniere, retard: f.smart.retard.mediane,
      per: f.finances?.per ?? null, croissanceCa: f.finances?.croissanceCa ?? null, margeNette: f.finances?.margeNette ?? null,
      detteSurFp: f.finances?.detteSurFp ?? null, volatilite: f.risque.volatilite, force6m: f.risque.force6m, scoreDetail: f.smart.scoreDetail,
    };
  }).sort((a, b) => b.score - a.score || b.acheteurs.length - a.acheteurs.length || b.derniere.localeCompare(a.derniere));
}
export { gte };

// ------------------------------------------------------------------ Portefeuilles miroirs

function allOps(db: Db): MirrorOp[] {
  return db.all<MirrorOp>(sql`
    SELECT o.ticker, COALESCE(o.societe, t.nom) AS societe, o.source, o.sens, o.qui, o.operation, o.date_publication AS datePublication,
           o.date_operation AS dateOperation, o.montant_usd AS montantUsd, r.trimestre AS trimestre
    FROM operations o LEFT JOIN raw_13f r ON r.cle_unique = o.cle_unique LEFT JOIN tickers t ON t.ticker = o.ticker`);
}

function barsCache(db: Db) {
  const m = new Map<string, ReturnType<typeof barsOf>>();
  return (t: string) => { if (!m.has(t)) m.set(t, barsOf(db, t)); return m.get(t)!; };
}

export type MirrorSummary = Omit<MirrorResult, "trades" | "courbe">;

/** Portefeuille miroir de chaque investisseur ayant au moins un achat (résumé, sans le détail des positions). */
export function getMirrors(db: Db): MirrorSummary[] {
  const ops = allOps(db);
  const bars = barsCache(db);
  const spy = bars("SPY");
  const acteurs = [...new Set(ops.filter(isMirrorBuy).map(acteurOf))];
  return acteurs.map((a) => { const { trades: _t, courbe: _c, ...rest } = mirrorFor(a, ops, bars, spy); return rest; })
    .sort((x, y) => (y.couverts > 0 ? 1 : 0) - (x.couverts > 0 ? 1 : 0) || (y.excedentMoyen ?? -9) - (x.excedentMoyen ?? -9));
}

/** Détail d'un portefeuille miroir : positions et courbe face au S&P 500. */
export function getMirror(db: Db, acteur: string): MirrorResult {
  const bars = barsCache(db);
  return mirrorFor(acteur, allOps(db), bars, bars("SPY"), { courbe: true });
}

// ------------------------------------------------------------------ Page action

export interface ActionData {
  ticker: string; societe: string | null;
  bars: { date: string; close: number; volume: number }[];
  ops: (typeof s.operations.$inferSelect)[];
  news: { date: string; kind: string; titre: string; resume: string | null; source: string | null; url: string | null; items: string | null; ton: number | null }[];
  fiche: Fiche;
  suivi: { id: number; type: string; valeur: string }[];
}

/** Tout ce qu'il faut pour la page d'une action. */
export function getActionData(db: Db, ticker: string, today: string): ActionData {
  const ops = db.select().from(s.operations).where(eq(s.operations.ticker, ticker)).orderBy(desc(s.operations.datePublication)).all();
  const societe = ops.find((o) => o.societe)?.societe ?? db.select({ n: s.tickers.nom }).from(s.tickers).where(eq(s.tickers.ticker, ticker)).get()?.n ?? null;
  const bars = barsOf(db, ticker).map((b) => ({ date: b.date, close: b.close, volume: b.volume }));
  const news = db.select({ date: s.newsItems.date, kind: s.newsItems.kind, titre: s.newsItems.titre, resume: s.newsItems.resume, source: s.newsItems.source, url: s.newsItems.url, items: s.newsItems.items, ton: s.newsItems.ton })
    .from(s.newsItems).where(eq(s.newsItems.ticker, ticker)).orderBy(desc(s.newsItems.date)).all();
  const acteurs = new Set(ops.map(acteurOf));
  const suivi = db.select().from(s.watchlist).all().filter((w) => (w.type === "action" && w.valeur === ticker) || (w.type === "investisseur" && acteurs.has(w.valeur))).map((w) => ({ id: w.id, type: w.type, valeur: w.valeur }));
  return { ticker, societe, bars, ops, news, fiche: getFiche(db, ticker, today), suivi };
}
