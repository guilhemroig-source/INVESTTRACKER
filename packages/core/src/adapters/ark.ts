import type { rawArk } from "../db/schema";
import { type AdapterResult, type TickerNames, abs } from "./types";
import { canonTicker } from "../parsers/util";

/** Format de data/ark_trades.json */
export interface ArkTradeJson {
  id?: number;
  date: string;
  fonds: string;
  operation: "Achat" | "Vente";
  ticker: string;
  montant_usd: number | null;
  pct_position: number | null;
  pct_etf: number | null;
  actions?: number | null;
  origine?: string;
}

export const arkKey = (r: ArkTradeJson) => `ARK|${r.date}|${r.fonds}|${r.ticker}|${r.operation}`;

export function adaptArk(input: ArkTradeJson[], names: TickerNames): AdapterResult<typeof rawArk.$inferInsert> {
  const rows = input.map((r) => ({ ...r, ticker: canonTicker(r.ticker) }));
  return {
    raw: rows.map((r) => ({
      date: r.date,
      fonds: r.fonds,
      operation: r.operation,
      ticker: r.ticker,
      montantUsd: abs(r.montant_usd),
      pctPosition: r.pct_position,
      pctEtf: r.pct_etf,
      actions: r.actions ?? null,
      origine: r.origine ?? "cathiesark",
      cleUnique: arkKey(r),
    })),
    operations: rows.map((r) => ({
      source: "ARK",
      categorie: "ARK",
      qui: `Cathie Wood (ARK · ${r.fonds})`,
      ticker: r.ticker,
      societe: names.get(r.ticker) ?? null,
      operation: r.operation,
      sens: r.operation === "Achat" ? "achat" : "vente",
      montantUsd: abs(r.montant_usd),
      fourchette: null,
      volume: r.actions ?? null,
      prix: r.actions && r.montant_usd ? Math.round((Math.abs(r.montant_usd) / Math.abs(r.actions)) * 100) / 100 : null,
      dateOperation: r.date,
      // ARK publie le soir même : la publication est datée du jour de séance.
      datePublication: r.date,
      sourceUrl: r.origine === "ark-csv" ? "https://www.ark-funds.com/" : "https://cathiesark.com/ark-funds-combined/trades",
      verifieEdgar: false,
      cleUnique: arkKey(r),
    })),
  };
}
