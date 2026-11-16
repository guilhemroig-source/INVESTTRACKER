import type { rawCongress } from "../db/schema";
import { type AdapterResult, type TickerNames, withOrdinal } from "./types";
import { canonTicker } from "../parsers/util";

/** Format de data/congress_trades.json */
export interface CongressTradeJson {
  id?: number;
  elu: string;
  chambre: string;
  etat: string | null;
  ticker: string;
  societe?: string | null;
  operation: "Achat" | "Vente";
  montant: string | null;
  date_transaction: string | null;
  date_declaration: string;
  perf_pct: number | null;
}
/** Format de data/congress_members.json */
export interface CongressMemberJson {
  elu: string; chambre: string; etat: string | null;
  transactions: number; achats: number; ventes: number; derniere_transaction: string | null;
}

const congressBase = (r: CongressTradeJson) =>
  `CONGRES|${r.elu}|${r.date_declaration}|${r.date_transaction ?? ""}|${r.ticker}|${r.operation}|${r.montant ?? ""}`;

export function adaptCongress(input: CongressTradeJson[], names: TickerNames): AdapterResult<typeof rawCongress.$inferInsert> {
  const rows = input.map((r) => ({ ...r, ticker: canonTicker(r.ticker) }));
  const keyed = withOrdinal(rows, congressBase);
  return {
    raw: keyed.map(({ row: r, key }) => ({
      elu: r.elu,
      chambre: r.chambre,
      etat: r.etat,
      ticker: r.ticker,
      societe: r.societe ?? names.get(r.ticker) ?? null,
      operation: r.operation,
      montant: r.montant,
      dateTransaction: r.date_transaction,
      dateDeclaration: r.date_declaration,
      perfPct: r.perf_pct,
      cleUnique: key,
    })),
    operations: keyed.map(({ row: r, key }) => ({
      source: "CONGRES",
      categorie: "Congrès",
      qui: `${r.elu} (${[r.chambre, r.etat].filter(Boolean).join(", ")})`,
      ticker: r.ticker,
      societe: r.societe ?? names.get(r.ticker) ?? null,
      operation: r.operation,
      sens: r.operation === "Achat" ? "achat" : "vente",
      montantUsd: null,
      fourchette: r.montant,
      volume: null,
      prix: null,
      dateOperation: r.date_transaction,
      datePublication: r.date_declaration,
      sourceUrl: r.chambre === "Sénat" ? "https://efdsearch.senate.gov/search/" : "https://disclosures-clerk.house.gov/FinancialDisclosure",
      verifieEdgar: false,
      cleUnique: key,
    })),
  };
}
