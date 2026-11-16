import type { raw13f } from "../db/schema";
import { type AdapterResult, type TickerNames } from "./types";
import { canonTicker } from "../parsers/util";

/** Format de data/superinvestors_13f.json */
export interface ThirteenFJson {
  id?: number;
  investisseur: string;
  fonds: string;
  trimestre: string; // "T2 2026"
  depose_le: string;
  ticker: string;
  societe?: string | null;
  cusip?: string | null;
  operation: "Nouvelle position" | "Renforcement" | "Allègement" | "Sortie totale";
  variation_actions: number | null;
  variation_pct: number | null;
  verifie_edgar?: boolean;
  source_url?: string | null;
}

export const thirteenFKey = (r: ThirteenFJson) => `13F|${r.fonds}|${r.trimestre}|${r.ticker}`;

export const BUY_13F = new Set(["Nouvelle position", "Renforcement"]);

/** "T2 2026" -> "2026-06-30" (date de fin du trimestre déclaré). */
export function quarterEnd(trimestre: string): string | null {
  const m = /^T([1-4])\s+(\d{4})$/.exec(trimestre.trim());
  if (!m) return null;
  return `${m[2]}-${["03-31", "06-30", "09-30", "12-31"][Number(m[1]) - 1]}`;
}

export function adapt13F(input: ThirteenFJson[], names: TickerNames): AdapterResult<typeof raw13f.$inferInsert> {
  const rows = input.map((r) => ({ ...r, ticker: canonTicker(r.ticker) }));
  return {
    raw: rows.map((r) => ({
      investisseur: r.investisseur,
      fonds: r.fonds,
      trimestre: r.trimestre,
      deposeLe: r.depose_le,
      ticker: r.ticker,
      societe: r.societe ?? names.get(r.ticker) ?? null,
      cusip: r.cusip ?? null,
      operation: r.operation,
      variationActions: r.variation_actions,
      variationPct: r.variation_pct,
      sourceUrl: r.source_url ?? null,
      verifieEdgar: !!r.verifie_edgar,
      cleUnique: thirteenFKey(r),
    })),
    operations: rows.map((r) => ({
      source: "13F",
      categorie: "Super-investisseur",
      qui: `${r.investisseur} (${r.fonds})`,
      ticker: r.ticker,
      societe: r.societe ?? names.get(r.ticker) ?? null,
      operation: r.operation,
      sens: BUY_13F.has(r.operation) ? "achat" : "vente",
      // Les 13F ne donnent pas de montant fiable : seulement le nombre d'actions.
      montantUsd: null,
      fourchette: null,
      volume: r.variation_actions,
      prix: null,
      dateOperation: quarterEnd(r.trimestre),
      datePublication: r.depose_le,
      sourceUrl: r.source_url ?? null,
      verifieEdgar: !!r.verifie_edgar,
      cleUnique: thirteenFKey(r),
    })),
  };
}
