import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import { type Analysis, type Bar, type TradeInput, analyzeTrade } from "./ta";
import { type NewsAnalysis, type NewsItem, companyAliases, explainWithNews } from "./news";

type Op = typeof s.operations.$inferSelect;

/** Données d'entrée de l'analyse pour une opération (trimestre pour les 13F). */
export function tradeInput(db: Db, o: Op): TradeInput {
  const trimestre = o.source === "13F" ? db.select({ t: s.raw13f.trimestre }).from(s.raw13f).where(eq(s.raw13f.cleUnique, o.cleUnique)).get()?.t ?? null : null;
  return { source: o.source, sens: o.sens, operation: o.operation, dateOperation: o.dateOperation, datePublication: o.datePublication, qui: o.qui, montantUsd: o.montantUsd, trimestre };
}

export function barsOf(db: Db, ticker: string): Bar[] {
  return db.select({ date: s.prices.date, open: s.prices.open, high: s.prices.high, low: s.prices.low, close: s.prices.close, volume: s.prices.volume })
    .from(s.prices).where(eq(s.prices.ticker, ticker)).orderBy(s.prices.date).all();
}

/** Recalcule la synthèse de toutes les opérations dont l'action a des cours ; renvoie le nombre d'analyses. */
export function refreshAnalyses(db: Db): { ok: number; insuffisant: number } {
  const tickers = new Set(db.all<{ ticker: string }>(sql`SELECT DISTINCT ticker FROM prices`).map((r) => r.ticker));
  const ops = db.select().from(s.operations).all().filter((o) => tickers.has(o.ticker));
  const cache = new Map<string, Bar[]>();
  const now = new Date().toISOString();
  let ok = 0, insuffisant = 0;
  db.transaction((tx) => {
    for (const o of ops) {
      if (!cache.has(o.ticker)) cache.set(o.ticker, barsOf(db, o.ticker));
      const a = analyzeTrade(cache.get(o.ticker)!, tradeInput(db, o));
      a.statut === "ok" ? ok++ : insuffisant++;
      const v = { cleUnique: o.cleUnique, statut: a.statut, pour: a.pour, contre: a.contre, neutres: a.neutres, ton: a.verdict.ton, dateRef: a.refDate, calculeLe: now,
        perf20: a.suite.find((x) => x.jours === 20)?.perf ?? null, perf60: a.suite.find((x) => x.jours === 60)?.perf ?? null };
      tx.insert(s.analyses).values(v).onConflictDoUpdate({ target: s.analyses.cleUnique, set: v }).run();
    }
  });
  return { ok, insuffisant };
}

const QUARTER: Record<string, [string, string]> = { "1": ["01-01", "03-31"], "2": ["04-01", "06-30"], "3": ["07-01", "09-30"], "4": ["10-01", "12-31"] };
const shiftDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

/** Nouvelles autour d'une opération : annonces officielles, presse, contexte de marché, hypothèses. */
export function newsAnalysisFor(db: Db, op: Op, input: TradeInput, bars: Bar[]): NewsAnalysis {
  const q = input.trimestre ? /^T([1-4]) (\d{4})$/.exec(input.trimestre) : null;
  const periode = q ? { debut: `${q[2]}-${QUARTER[q[1]][0]}`, fin: `${q[2]}-${QUARTER[q[1]][1]}` } : null;
  const ref = periode?.fin ?? input.dateOperation ?? input.datePublication;
  const from = shiftDays(periode?.debut ?? ref, -60), to = shiftDays(ref, 5);
  const items = db.select().from(s.newsItems).where(and(eq(s.newsItems.ticker, op.ticker), gte(s.newsItems.date, from), lte(s.newsItems.date, to))).all() as NewsItem[];
  const cover = db.select().from(s.newsFetch).where(and(eq(s.newsFetch.ticker, op.ticker), eq(s.newsFetch.kind, "presse"), lte(s.newsFetch.debut, ref), gte(s.newsFetch.fin, ref))).all();
  const ok = cover.some((c) => c.statut === "ok");
  const note = ok ? undefined : cover.some((c) => c.statut === "hors-fenetre") ? "Archive de presse limitée aux 3 derniers mois (GDELT) : seules les annonces officielles sont disponibles pour cette date."
    : "Presse pas encore collectée pour cette opération (collecteur « news », par lots).";
  const nom = db.select({ n: s.tickers.nom }).from(s.tickers).where(eq(s.tickers.ticker, op.ticker)).get()?.n ?? op.societe;
  return explainWithNews({ sens: op.sens, refDate: ref, source: op.source, operation: op.operation, periode }, bars, barsOf(db, "SPY"), barsOf(db, "QQQ"), items, ok, note, companyAliases(nom, op.ticker));
}

/** Analyse complète d'une opération (page détail), calculée à la demande. */
export function getTradeAnalysis(db: Db, cle: string): { op: Op; analysis: Analysis | null; societe: string | null; news: NewsAnalysis } | null {
  const op = db.select().from(s.operations).where(eq(s.operations.cleUnique, cle)).get();
  if (!op) return null;
  const bars = barsOf(db, op.ticker);
  const input = tradeInput(db, op);
  const societe = op.societe ?? db.select({ n: s.tickers.nom }).from(s.tickers).where(eq(s.tickers.ticker, op.ticker)).get()?.n ?? null;
  return { op, societe, analysis: bars.length ? analyzeTrade(bars, input) : null, news: newsAnalysisFor(db, op, input, bars) };
}
