import { type Db, schema as s } from "@tracker/core";
import { sql } from "drizzle-orm";
import { getText } from "../http";
import { TOOL_UA } from "../env";
import { type Collector, isoDate } from "./types";

/**
 * Taux de change de référence de la BCE (dollars pour 1 euro), pour « Mon portefeuille » en euros.
 * Source officielle et gratuite, sans clé : API SDMX de la Banque centrale européenne (série EXR.D.USD.EUR.SP00.A).
 */
export const ECB_URL = (start: string) => `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=${start}&format=csvdata`;

/** Extrait (date, taux) du CSV SDMX de la BCE ; colonnes repérées par leur nom. */
export function parseEcbCsv(csv: string): { date: string; eurusd: number }[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines.shift()?.split(",") ?? [];
  const iD = head.indexOf("TIME_PERIOD"), iV = head.indexOf("OBS_VALUE");
  if (iD < 0 || iV < 0) throw new Error("Format BCE inattendu (colonnes TIME_PERIOD / OBS_VALUE absentes)");
  return lines.map((l) => l.split(",")).map((c) => ({ date: c[iD], eurusd: Number(c[iV]) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.eurusd > 0);
}

export const collectChange: Collector = async (db: Db) => {
  const last = db.get<{ d: string | null }>(sql`SELECT MAX(date) d FROM change`)?.d;
  // Historique depuis 2015 au premier passage, puis les 10 derniers jours (rattrapage des corrections)
  const start = last ? isoDate(new Date(Date.parse(last) - 10 * 86400_000)) : "2015-01-01";
  const rows = parseEcbCsv(await getText(ECB_URL(start), { userAgent: TOOL_UA, cacheTtl: 0, accept: "text/csv" }));
  db.transaction((tx) => {
    for (const r of rows) tx.insert(s.change).values(r).onConflictDoUpdate({ target: s.change.date, set: { eurusd: r.eurusd } }).run();
  });
  const fin = rows.at(-1);
  return { lues: rows.length, nouvelles: rows.length, donneesAu: fin?.date ?? last ?? null, details: fin ? [`1 € = ${fin.eurusd} $ au ${fin.date}`] : ["Aucun nouveau taux"] };
};
