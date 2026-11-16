import { backfillSocietes, canonTicker, schema, upsertTickers } from "@tracker/core";
import { eq } from "drizzle-orm";
import { getJson } from "../http";
import { secUserAgent } from "../env";
import type { Collector } from "./types";

/** Complète la table des sociétés avec la liste officielle de la SEC (symbole → nom, CIK). */
export const collectTickers: Collector = async (db) => {
  const data = await getJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    "https://www.sec.gov/files/company_tickers.json", { userAgent: secUserAgent(), cacheTtl: 86400 });
  // upsertTickers ramène BRK-B (SEC) à la forme unique BRK.B.
  const rows = Object.values(data).map((r) => ({ ticker: r.ticker, nom: prettify(r.title), origine: "sec" }));
  const nouvelles = upsertTickers(db, rows);
  // CIK de chaque société (pour retrouver ses annonces officielles 8-K)
  db.transaction((tx) => {
    for (const r of Object.values(data)) tx.update(schema.tickers).set({ cik: String(r.cik_str).padStart(10, "0") }).where(eq(schema.tickers.ticker, canonTicker(r.ticker))).run();
  });
  backfillSocietes(db);
  return { lues: rows.length, nouvelles };
};

/** "TESLA, INC." -> "Tesla, Inc." (les noms SEC sont souvent en capitales). */
function prettify(t: string) {
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-&./(])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Inc|Corp|Co|Ltd|Plc|Llc|Lp|Sa|Nv|Ag)\b/g, (m) => m);
}
