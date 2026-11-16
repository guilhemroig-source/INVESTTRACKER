import type { rawTrump } from "../db/schema";
import { type AdapterResult, type TickerNames, withOrdinal } from "./types";
import { canonTicker } from "../parsers/util";

/** Format de data/trump_recent.json */
export interface TrumpTxJson {
  id?: number;
  ticker: string;
  operation: "Achat" | "Vente";
  montant: string;
  montant_min: number | null;
  montant_max: number | null;
  date_transaction: string | null;
  depose_le: string;
  nom_declare?: string | null;
  non_verifie?: boolean;
}
export interface TrumpFilingJson {
  depose_le: string; periode: string; debut: string; fin: string;
  transactions: number; achats: number; ventes: number;
}
export interface TrumpTickerJson { ticker: string; transactions: number }
export interface TrumpMetaJson {
  a_jour_au: string; delai_median_jours: number; part_hors_delai_45j: number;
  premiere_transaction: string; derniere_transaction: string;
}

const trumpBase = (r: TrumpTxJson) => `TRUMP|${r.depose_le}|${r.date_transaction ?? ""}|${r.ticker}|${r.operation}|${r.montant}`;

export function adaptTrump(input: TrumpTxJson[], names: TickerNames): AdapterResult<typeof rawTrump.$inferInsert> {
  const rows = input.map((r) => ({ ...r, ticker: canonTicker(r.ticker) }));
  const keyed = withOrdinal(rows, trumpBase);
  return {
    raw: keyed.map(({ row: r, key }) => ({
      ticker: r.ticker,
      operation: r.operation,
      montant: r.montant,
      montantMin: r.montant_min,
      montantMax: r.montant_max,
      nomDeclare: r.nom_declare ?? null,
      nonVerifie: !!r.non_verifie,
      dateTransaction: r.date_transaction,
      deposeLe: r.depose_le,
      cleUnique: key,
    })),
    operations: keyed.map(({ row: r, key }) => ({
      source: "TRUMP",
      categorie: "Trump",
      qui: "Donald Trump (Président)",
      ticker: r.ticker,
      societe: names.get(r.ticker) ?? null,
      operation: r.operation,
      sens: r.operation === "Achat" ? "achat" : "vente",
      montantUsd: null,
      fourchette: r.montant,
      volume: null,
      prix: null,
      dateOperation: r.date_transaction,
      datePublication: r.depose_le,
      sourceUrl: "https://getsignal.finance/president/donald-trump",
      verifieEdgar: false,
      cleUnique: key,
    })),
  };
}
