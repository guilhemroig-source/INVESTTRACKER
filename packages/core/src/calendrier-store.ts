import { sql } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import { next13FDeadline } from "./deadlines";
import { acteurOf } from "./fiche";

/**
 * Réunions de politique monétaire de la Fed (FOMC) : jour de la décision (2e jour), annonce à 14h00 heure de New York.
 * Source : calendrier publié par la Réserve fédérale (federalreserve.gov/monetarypolicy/fomccalendars.htm).
 */
export const FOMC_DECISIONS = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];

export interface EvenementVue {
  date: string; heure: string | null; type: "resultats" | "nouvelle" | "macro" | "echeance";
  ticker: string | null; societe: string | null; titre: string; details: Record<string, unknown> | null;
  source: string; url: string | null;
  /** Action de mon portefeuille ou de ma liste */
  mien: boolean; detenu: boolean;
  /** Investisseurs suivis qui ont acheté / vendu l'action ces 90 derniers jours */
  acheteurs: string[]; vendeurs: string[];
  passe: boolean;
}
export interface Calendrier { du: string; au: string; aujourdhui: string; evenements: EvenementVue[]; resultatsCollectes: boolean }

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

/** Calendrier de J−7 à J+45 : résultats et nouvelles de mes actions et de celles des investisseurs, Fed, échéances 13F. */
export function getCalendrier(db: Db, today: string, jours = 45): Calendrier {
  const du = addDays(today, -7), au = addDays(today, jours);
  const detenues = new Set(db.all<{ t: string }>(sql`SELECT ticker t FROM portfolio_tx GROUP BY ticker HAVING SUM(CASE type WHEN 'achat' THEN quantite WHEN 'vente' THEN -quantite ELSE 0 END) > 0`).map((r) => r.t));
  const liste = new Set(db.all<{ t: string }>(sql`SELECT valeur t FROM watchlist WHERE type = 'action'`).map((r) => r.t));
  const since = addDays(today, -90);
  const ops = db.all<{ ticker: string; sens: string; source: string; qui: string; operation: string }>(sql`
    SELECT ticker, sens, source, qui, operation FROM operations WHERE date_publication >= ${since}
      AND NOT (source = 'FORM4' AND (operation LIKE '%exercice%' OR operation LIKE 'Retenue%' OR operation LIKE 'Don%'))`);
  const inv = new Map<string, { a: Set<string>; v: Set<string> }>();
  for (const o of ops) {
    const m = inv.get(o.ticker) ?? inv.set(o.ticker, { a: new Set(), v: new Set() }).get(o.ticker)!;
    (o.sens === "achat" ? m.a : m.v).add(acteurOf(o));
  }
  const noms = new Map(db.all<{ t: string; n: string | null }>(sql`
    SELECT ticker t, nom n FROM tickers UNION ALL SELECT ticker, nom FROM actifs_perso`).map((r) => [r.t, r.n]));

  const rows = db.select().from(s.evenements).where(sql`${s.evenements.date} >= ${du} AND ${s.evenements.date} <= ${au}`).all();
  const out: EvenementVue[] = [];
  for (const r of rows) {
    const t = r.ticker;
    const mien = !!t && (detenues.has(t) || liste.has(t));
    const i = t ? inv.get(t) : undefined;
    // Ne garder que mes actions et celles des investisseurs suivis
    if (!mien && !i) continue;
    out.push({
      date: r.date, heure: r.heure, type: r.type as EvenementVue["type"], ticker: t, societe: t ? noms.get(t) ?? null : null,
      titre: r.titre, details: r.details ? JSON.parse(r.details) : null, source: r.source, url: r.url,
      mien, detenu: !!t && detenues.has(t), acheteurs: i ? [...i.a] : [], vendeurs: i ? [...i.v] : [], passe: r.date < today,
    });
  }
  const general = (date: string, titre: string, type: EvenementVue["type"], heure: string | null, source: string, url: string | null, details: Record<string, unknown> | null = null) =>
    out.push({ date, heure, type, ticker: null, societe: null, titre, details, source, url, mien: false, detenu: false, acheteurs: [], vendeurs: [], passe: date < today });
  for (const d of FOMC_DECISIONS.filter((x) => x >= du && x <= au))
    general(d, "Décision de taux de la Fed (FOMC)", "macro", "20:00", "Réserve fédérale", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      { texte: "Annonce à 14h00 à New York (20h00 à Paris), conférence de presse 30 minutes après. Influence l'ensemble du marché, surtout les valeurs de croissance." });
  const f = next13FDeadline(du);
  if (f.limite <= au) general(f.limite, `Date limite des 13F (${f.trimestre})`, "echeance", null, "SEC", null,
    { texte: "Les grands fonds publient leur portefeuille du trimestre : nouvelles positions des super-investisseurs dans les jours qui suivent." });

  const ordre = { macro: 0, echeance: 1, resultats: 2, nouvelle: 3 };
  out.sort((a, b) => a.date.localeCompare(b.date) || ordre[a.type] - ordre[b.type] || Number(b.mien) - Number(a.mien) || (b.acheteurs.length + b.vendeurs.length) - (a.acheteurs.length + a.vendeurs.length) || (a.ticker ?? "").localeCompare(b.ticker ?? ""));
  const resultatsCollectes = (db.get<{ n: number }>(sql`SELECT COUNT(*) n FROM evenements WHERE type = 'resultats'`)?.n ?? 0) > 0;
  return { du, au, aujourdhui: today, evenements: out, resultatsCollectes };
}
