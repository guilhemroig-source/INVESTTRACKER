import { computeFundamentals, schema as s, type CompanyFacts } from "@tracker/core";
import { sql } from "drizzle-orm";
import { HttpError, getJson } from "../http";
import { secUserAgent } from "../env";
import type { Collector } from "./types";

/**
 * Comptes des sociétés (API XBRL « companyfacts » de la SEC, gratuite) : chiffre d'affaires, bénéfice, BPA,
 * trésorerie, dette, flux de trésorerie, nombre d'actions. Rafraîchis chaque semaine, par lots (FUND_MAX_PER_RUN).
 */
export const collectFondamentaux: Collector = async (db) => {
  const max = Number(process.env.FUND_MAX_PER_RUN || 80);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const todo = db.all<{ ticker: string; cik: string | null; maj: string | null }>(sql`
    SELECT o.ticker, t.cik, f.maj_le AS maj, MAX(o.date_publication) AS pub
    FROM operations o LEFT JOIN tickers t ON t.ticker = o.ticker LEFT JOIN fundamentals f ON f.ticker = o.ticker
    GROUP BY o.ticker HAVING f.maj_le IS NULL OR f.maj_le < ${weekAgo} ORDER BY pub DESC`);
  let lues = 0, nouvelles = 0, indispo = 0;
  const details: string[] = [];
  for (const t of todo.slice(0, max)) {
    const now = new Date().toISOString();
    const save = (v: Partial<typeof s.fundamentals.$inferInsert> & { statut: string }) => {
      const row = { ticker: t.ticker, cik: t.cik, majLe: now, erreur: null, ...v };
      db.insert(s.fundamentals).values(row as typeof s.fundamentals.$inferInsert).onConflictDoUpdate({ target: s.fundamentals.ticker, set: row }).run();
    };
    if (!t.cik) { indispo++; save({ statut: "indisponible", erreur: "Pas de CIK SEC (fonds, société étrangère ou symbole inconnu)." }); continue; }
    try {
      const cf = await getJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${t.cik}.json`, { userAgent: secUserAgent(), cacheTtl: 0, timeoutMs: 60_000 });
      lues++;
      const f = computeFundamentals(cf);
      if (!f || (f.revenuTtm == null && f.netTtm == null)) { indispo++; save({ statut: "indisponible", erreur: "Comptes non publiés en normes américaines (US GAAP)." }); continue; }
      save({ statut: "ok", ...f });
      nouvelles++;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) { indispo++; save({ statut: "indisponible", erreur: "Aucun compte XBRL publié." }); continue; }
      save({ statut: "erreur", erreur: (e as Error).message });
      details.push(`${t.ticker} : ${(e as Error).message}`);
    }
  }
  details.unshift(`${nouvelles} société(s) mises à jour, ${indispo} sans comptes exploitables, ${Math.max(0, todo.length - max)} en attente`);
  return { lues, nouvelles, details };
};
