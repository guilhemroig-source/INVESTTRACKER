import type { rawInsider } from "../db/schema";
import { type AdapterResult, type TickerNames, abs } from "./types";
import { canonTicker, personKey } from "../parsers/util";

/** Format de data/insider_trades.json, data/tesla_insiders.json, data/spacex_musk.json */
export interface InsiderJson {
  id?: number;
  depose_le: string;
  heure_depot?: string | null;
  date_operation: string | null;
  ticker?: string;
  societe?: string;
  initie: string;
  fonction?: string | null;
  operation: string;
  prix: number | null;
  quantite: number | null;
  montant_usd: number | null;
  source?: string;
  source_url?: string | null;
  code_transaction?: string | null;
  accession?: string | null;
  insider_cik?: string | null;
}

export type InsiderList = "gros" | "tesla" | "spacex";

/**
 * Clé d'une ligne, commune à toutes les sources (kit, OpenInsider, EDGAR) : symbole, déclarant (ordre des mots
 * indifférent), date d'opération, nombre d'actions signé. Le libellé et le prix (arrondi différemment selon
 * la source) n'en font pas partie.
 */
export const form4Key = (ticker: string, r: Pick<InsiderJson, "initie" | "date_operation" | "quantite">) =>
  `FORM4|${ticker}|${personKey(r.initie)}|${r.date_operation ?? ""}|${r.quantite ?? ""}`;

/** Clé d'une déclaration : une déclaration (symbole, déclarant, date de dépôt) n'est importée que par une seule source. */
export const filingKey = (ticker: string, initie: string, deposeLe: string) => `${ticker}|${personKey(initie)}|${deposeLe}`;

/** Achat si le nombre d'actions détenues augmente, vente sinon. */
export function form4Sens(r: InsiderJson): "achat" | "vente" {
  if (r.quantite != null && r.quantite !== 0) return r.quantite > 0 ? "achat" : "vente";
  if (r.montant_usd != null && r.montant_usd !== 0) return r.montant_usd > 0 ? "achat" : "vente";
  return /^achat|attribution|exercice|réception|conversion/i.test(r.operation) ? "achat" : "vente";
}

const KEEP_UPPER = new Set(["LLC", "LP", "LLP", "II", "III", "IV", "USA", "US"]);
const tidyCase = (s: string) => s !== s.toUpperCase() ? s
  : s.split(/(\s+)/).map((w) => (KEEP_UPPER.has(w.replace(/,$/, "")) ? w : w.toLowerCase().replace(/(^|[-'.(])([a-z])/g, (_, a, b) => a + b.toUpperCase()))).join("");

/** "Musk Elon" (ordre SEC) -> "Elon Musk" ; noms en capitales remis en casse normale ; sociétés laissées dans l'ordre. */
export function displayName(secName: string): string {
  const name = tidyCase(secName.trim());
  const parts = name.split(/\s+/);
  const isCompany = /,|\b(llc|lp|inc|corp|fund|trust|capital|partners|advisors|holdings|management)\b/i.test(name);
  return parts.length === 2 && !isCompany ? `${parts[1]} ${parts[0]}` : name;
}

export function adaptForm4(
  rows: InsiderJson[],
  list: InsiderList,
  names: TickerNames,
): AdapterResult<typeof rawInsider.$inferInsert> {
  const fixedTicker = list === "tesla" ? "TSLA" : list === "spacex" ? "SPCX" : null;
  const categorie = list === "gros" ? "Initié" : "Tesla / SpaceX";
  const out: AdapterResult<typeof rawInsider.$inferInsert> = { raw: [], operations: [] };
  for (const r of rows) {
    const ticker = fixedTicker ?? (r.ticker ? canonTicker(r.ticker) : undefined);
    if (!ticker) continue;
    const societe = r.societe ?? names.get(ticker) ?? null;
    const verifie = list !== "gros" || /edgar/i.test(r.source ?? "");
    const key = form4Key(ticker, r);
    out.raw.push({
      liste: list,
      deposeLe: r.depose_le,
      heureDepot: r.heure_depot ?? null,
      dateOperation: r.date_operation,
      ticker,
      societe,
      initie: r.initie,
      fonction: r.fonction ?? null,
      operation: r.operation,
      codeTransaction: r.code_transaction ?? null,
      prix: r.prix,
      quantite: r.quantite,
      montantUsd: r.montant_usd,
      origine: r.source ?? (list === "gros" ? "OpenInsider" : "SEC EDGAR"),
      accession: r.accession ?? null,
      insiderCik: r.insider_cik ?? null,
      cleDeclaration: filingKey(ticker, r.initie, r.depose_le),
      sourceUrl: r.source_url ?? null,
      verifieEdgar: verifie,
      cleUnique: key,
    });
    out.operations.push({
      source: "FORM4",
      categorie,
      qui: r.fonction ? `${displayName(r.initie)} (${r.fonction})` : displayName(r.initie),
      ticker,
      societe,
      operation: r.operation,
      sens: form4Sens(r),
      montantUsd: abs(r.montant_usd),
      fourchette: null,
      volume: r.quantite,
      prix: r.prix,
      dateOperation: r.date_operation,
      datePublication: r.depose_le,
      sourceUrl: r.source_url ?? null,
      verifieEdgar: verifie,
      cleUnique: key,
    });
  }
  return out;
}
