import { type Db, schema as s } from "@tracker/core";
import { sql } from "drizzle-orm";
import { HttpError, getJson } from "../http";
import { TOOL_UA } from "../env";
import { type Collector, isoDate } from "./types";

/**
 * Calendrier (Finnhub, clé gratuite FINNHUB_API_KEY, 60 requêtes/minute) :
 *  - publications de résultats des 14 derniers jours et des 90 prochains, pour les actions suivies
 *    (opérations des investisseurs depuis 6 mois, mon portefeuille, ma liste) ;
 *  (les nouvelles des sociétés sont collectées par « societes »).
 */
const API = "https://finnhub.io/api/v1";
const addDays = (iso: string, n: number) => isoDate(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000));

export interface FinnhubEarning { symbol: string; date: string; hour: string; quarter: number; year: number; epsEstimate: number | null; epsActual: number | null; revenueEstimate: number | null; revenueActual: number | null }
export interface FinnhubNews { id: number; datetime: number; headline: string; summary: string; source: string; url: string; related: string; category: string }

/** Actions concernées : celles des investisseurs suivis (6 mois), de mon portefeuille et de ma liste. */
export function universe(db: Db, today: string): { tous: Set<string>; miens: string[] } {
  const since = addDays(today, -180);
  const perso = new Set(db.select({ t: s.actifsPerso.ticker }).from(s.actifsPerso).all().map((r) => r.t));
  const ops = db.all<{ t: string }>(sql`SELECT DISTINCT ticker t FROM operations WHERE date_publication >= ${since}`).map((r) => r.t);
  const pf = db.all<{ t: string }>(sql`SELECT DISTINCT ticker t FROM portfolio_tx`).map((r) => r.t).filter((t) => !perso.has(t));
  const liste = db.all<{ t: string }>(sql`SELECT DISTINCT valeur t FROM watchlist WHERE type = 'action'`).map((r) => r.t);
  const miens = [...new Set([...pf, ...liste])];
  return { tous: new Set([...ops, ...miens]), miens };
}

export function earningRow(e: FinnhubEarning, now: string) {
  return {
    cle: `res:${e.symbol}:${e.year}T${e.quarter}`, date: e.date, heure: e.hour || null, ticker: e.symbol, type: "resultats",
    titre: `Résultats T${e.quarter} (exercice ${e.year})`, source: "Finnhub", url: null, collecteLe: now,
    details: JSON.stringify({ trimestre: e.quarter, annee: e.year, bpaEstime: e.epsEstimate, bpaReel: e.epsActual, caEstime: e.revenueEstimate, caReel: e.revenueActual }),
  };
}

export const collectCalendrier: Collector = async (db) => {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) throw new Error("FINNHUB_API_KEY manquant (clé gratuite sur finnhub.io)");
  const opts = { userAgent: TOOL_UA, cacheTtl: 0, headers: { "X-Finnhub-Token": key } };
  const today = isoDate(new Date()), now = new Date().toISOString();
  const { tous, miens } = universe(db, today);
  let lues = 0, nouvelles = 0;
  const details: string[] = [];

  // Résultats : tranches de 7 jours (la réponse « toutes sociétés » est volumineuse)
  let res = 0;
  for (let d = addDays(today, -14); d <= addDays(today, 90); d = addDays(d, 7)) {
    const r = await getJson<{ earningsCalendar: FinnhubEarning[] }>(`${API}/calendar/earnings?from=${d}&to=${addDays(d, 6)}`, opts);
    const rows = (r.earningsCalendar ?? []).filter((e) => tous.has(e.symbol)).map((e) => earningRow(e, now));
    lues += r.earningsCalendar?.length ?? 0;
    db.transaction((tx) => {
      for (const row of rows) tx.insert(s.evenements).values(row).onConflictDoUpdate({ target: s.evenements.cle, set: { date: row.date, heure: row.heure, titre: row.titre, details: row.details, collecteLe: now } }).run();
    });
    res += rows.length;
  }
  details.push(`${res} publication(s) de résultats suivies (J−14 à J+90)`);

  nouvelles = res;
  return { lues, nouvelles, details, donneesAu: today };
};
