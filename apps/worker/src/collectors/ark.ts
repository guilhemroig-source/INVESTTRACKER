import { type ArkTrade, type ArkTradeJson, type Db, adaptArk, insertIgnore, insertOperations, loadTickerNames, parseArkHoldingsCsv, parseCathiesArkTrades, schema as s, upsertTickers } from "@tracker/core";
import { and, eq, sql } from "drizzle-orm";
import { getText } from "../http";
import { TOOL_UA } from "../env";
import type { Collector } from "./types";

export const ARK_TRADES_URL = "https://cathiesark.com/ark-funds-combined/trades";
const CSV_BASE = "https://assets.ark-funds.com/fund-documents/funds-etf-csv/";
export const ARK_CSV: Record<string, string> = {
  ARKK: "ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv",
  ARKW: "ARK_NEXT_GENERATION_INTERNET_ETF_ARKW_HOLDINGS.csv",
  ARKG: "ARK_GENOMIC_REVOLUTION_ETF_ARKG_HOLDINGS.csv",
  ARKQ: "ARK_AUTONOMOUS_TECH._&_ROBOTICS_ETF_ARKQ_HOLDINGS.csv",
  ARKF: "ARK_BLOCKCHAIN_&_FINTECH_INNOVATION_ETF_ARKF_HOLDINGS.csv",
  ARKX: "ARK_SPACE_&_DEFENSE_INNOVATION_ETF_ARKX_HOLDINGS.csv",
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-&./])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/-Cl [A-Z]$/i, "");

/** Télécharge les positions du jour de chaque fonds ARK (flux direct publié par ARK). */
async function collectHoldings(db: Db) {
  let n = 0;
  const errors: string[] = [];
  for (const [fund, file] of Object.entries(ARK_CSV)) {
    try {
      const rows = parseArkHoldingsCsv(await getText(CSV_BASE + encodeURIComponent(file).replace(/%2F/g, "/"), { userAgent: TOOL_UA, cacheTtl: 3600 }));
      const valid = rows.filter((r) => r.ticker && r.fonds === fund);
      n += insertIgnore(db, s.rawArkHoldings, valid.map((r) => ({
        date: r.date, fonds: r.fonds, ticker: r.ticker, cusip: r.cusip || "", societe: r.societe, actions: r.actions, valeurUsd: r.valeur_usd, poidsPct: r.poids_pct,
      })));
      upsertTickers(db, valid.map((r) => ({ ticker: r.ticker, nom: titleCase(r.societe), origine: "ark-csv", cusip: r.cusip })));
    } catch (e) { errors.push(`${fund} : ${(e as Error).message}`); }
  }
  return { n, errors };
}

/** Variation d'actions entre deux fichiers de positions consécutifs, par fonds et symbole. */
export function holdingDeltas(db: Db) {
  const rows = db.all<{ fonds: string; ticker: string; date: string; prev_date: string; actions: number; prev_actions: number; valeur: number | null }>(sql`
    WITH d AS (SELECT DISTINCT fonds, date FROM raw_ark_holdings),
    pairs AS (SELECT a.fonds, a.date, (SELECT MAX(b.date) FROM d b WHERE b.fonds = a.fonds AND b.date < a.date) AS prev_date FROM d a)
    SELECT p.fonds, COALESCE(h.ticker, ph.ticker) AS ticker, p.date, p.prev_date,
           COALESCE(h.actions, 0) AS actions, COALESCE(ph.actions, 0) AS prev_actions, h.valeur_usd AS valeur
    FROM pairs p
    JOIN raw_ark_holdings h ON h.fonds = p.fonds AND h.date = p.date
    LEFT JOIN raw_ark_holdings ph ON ph.fonds = p.fonds AND ph.date = p.prev_date AND ph.ticker = h.ticker
    WHERE p.prev_date IS NOT NULL
    UNION ALL
    SELECT p.fonds, ph.ticker, p.date, p.prev_date, 0, ph.actions, NULL
    FROM pairs p JOIN raw_ark_holdings ph ON ph.fonds = p.fonds AND ph.date = p.prev_date
    WHERE p.prev_date IS NOT NULL AND NOT EXISTS (SELECT 1 FROM raw_ark_holdings h WHERE h.fonds = p.fonds AND h.date = p.date AND h.ticker = ph.ticker)`);
  return rows.filter((r) => r.actions !== r.prev_actions);
}

/**
 * Recoupe chaque opération publiée avec la variation des positions du même fonds
 * (fichier du jour de l'opération ou du jour ouvré suivant) : nombre d'actions exact.
 */
export function reconcile(db: Db) {
  const deltas = holdingDeltas(db);
  let n = 0;
  const trades = db.select().from(s.rawArk).where(sql`${s.rawArk.actions} IS NULL`).all();
  for (const t of trades) {
    const d = deltas.find((x) => x.fonds === t.fonds && x.ticker === t.ticker && x.prev_date <= t.date && x.date >= t.date
      && x.date <= addDays(t.date, 4) && Math.sign(x.actions - x.prev_actions) === (t.operation === "Achat" ? 1 : -1));
    if (!d) continue;
    const delta = d.actions - d.prev_actions;
    db.update(s.rawArk).set({ actions: delta }).where(eq(s.rawArk.id, t.id)).run();
    db.update(s.operations).set({ volume: delta, prix: t.montantUsd ? Math.round((t.montantUsd / Math.abs(delta)) * 100) / 100 : null })
      .where(and(eq(s.operations.cleUnique, t.cleUnique))).run();
    n++;
  }
  return { n, deltas };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

/** Opérations reconstituées à partir des fichiers de positions, quand cathiesark est indisponible. */
export function tradesFromDeltas(deltas: ReturnType<typeof holdingDeltas>): ArkTradeJson[] {
  return deltas.map((d) => {
    const delta = d.actions - d.prev_actions;
    const price = d.valeur && d.actions ? d.valeur / d.actions : null;
    return {
      date: d.prev_date, // les positions du jour J reflètent les opérations de la séance précédente
      fonds: d.fonds, ticker: d.ticker, operation: delta > 0 ? "Achat" : "Vente",
      montant_usd: price ? Math.round(Math.abs(delta) * price) : null,
      pct_position: d.prev_actions ? Math.round((Math.abs(delta) / d.prev_actions) * 10000) / 100 : null,
      pct_etf: null, actions: delta, origine: "ark-csv",
    };
  });
}

/** ARK : opérations du jour (cathiesark) + positions publiées par ARK pour recouper ; secours : positions seules. */
export const collectArk: Collector = async (db) => {
  const holdings = await collectHoldings(db);
  let trades: ArkTrade[] = [];
  let tradesError: string | null = null;
  try { trades = parseCathiesArkTrades(await getText(ARK_TRADES_URL, { userAgent: TOOL_UA, cacheTtl: 0 })); }
  catch (e) { tradesError = (e as Error).message; }

  const details = [`positions : ${holdings.n} lignes nouvelles`, ...holdings.errors.map((e) => `positions en échec : ${e}`)];
  let nouvelles = 0;
  if (trades.length) {
    const r = adaptArk(trades, loadTickerNames(db));
    insertIgnore(db, s.rawArk, r.raw);
    nouvelles = insertOperations(db, r.operations);
  }
  const rec = reconcile(db);
  details.push(`${rec.n} opération(s) recoupée(s) avec les positions ARK`);

  if (tradesError) {
    if (holdings.errors.length === Object.keys(ARK_CSV).length) throw new Error(`cathiesark et fichiers ARK indisponibles : ${tradesError}`);
    // Secours : seules les séances absentes de la base sont reconstituées.
    const known = new Set(db.select({ d: s.rawArk.date }).from(s.rawArk).all().map((x) => x.d));
    const fallback = tradesFromDeltas(rec.deltas).filter((t) => !known.has(t.date));
    const r = adaptArk(fallback, loadTickerNames(db));
    insertIgnore(db, s.rawArk, r.raw);
    nouvelles += insertOperations(db, r.operations);
    details.push(`cathiesark indisponible (${tradesError}) : ${fallback.length} opération(s) reconstituée(s) depuis les positions ARK`);
  }
  const all = db.select({ d: s.rawArk.date }).from(s.rawArk).all().map((x) => x.d).sort();
  return { lues: trades.length, nouvelles, donneesAu: all.at(-1) ?? null, details };
};
