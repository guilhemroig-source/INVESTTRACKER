import { canonTicker, parseDate, parseNum } from "./util";

export type Op13F = "Nouvelle position" | "Renforcement" | "Allègement" | "Sortie totale";

/** "Buy - Position Entry" -> Nouvelle position, "Buy" -> Renforcement, "Sell" -> Allègement, "Sell - Position Exit" -> Sortie totale */
export function insidersetOperation(type: string): Op13F | null {
  const t = type.toLowerCase();
  if (t.startsWith("buy")) return /entry|new/.test(t) ? "Nouvelle position" : "Renforcement";
  if (t.startsWith("sell")) return /exit|sold out/.test(t) ? "Sortie totale" : "Allègement";
  return null;
}

export interface InsidersetMove {
  ticker: string;
  societe: string;
  trimestre: string; // "T2 2026"
  operation: Op13F;
  variation_actions: number | null;
  variation_pct: number | null;
  restant: number | null;
}

/** "Q2 2026" -> "T2 2026" */
export const toTrimestre = (q: string) => q.replace(/^Q(\d)\s*(\d{4})$/i, "T$1 $2");

/**
 * Lit la page « activity » d'un investisseur insiderset. Toutes les lignes (y compris celles des pages suivantes,
 * paginées côté navigateur) sont dans le JSON `#activity-table-data`. La colonne « Value » n'est pas reprise (non fiable).
 */
export function parseInsidersetActivity(html: string): InsidersetMove[] {
  const m = /<script[^>]*id="activity-table-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("insiderset : données d'activité introuvables (#activity-table-data)");
  const data = JSON.parse(m[1]) as { rows: { symbol: string; company: string; quarter_label: string; type: string; change_qty_display: string | null; pct_change_display: string | null; remaining_display: string | null }[] };
  return data.rows.flatMap((r) => {
    const op = insidersetOperation(r.type);
    if (!op || !r.symbol) return [];
    return [{
      ticker: canonTicker(r.symbol),
      societe: r.company,
      trimestre: toTrimestre(r.quarter_label),
      operation: op,
      variation_actions: parseNum(r.change_qty_display),
      variation_pct: op === "Sortie totale" ? -100 : op === "Nouvelle position" ? null : parseNum(r.pct_change_display),
      restant: parseNum(r.remaining_display),
    }];
  });
}

/** Lit la page d'un investisseur : dernier trimestre déclaré et date de publication. */
export function parseInsidersetInvestor(html: string): { trimestre: string; quarter: string; depose_le: string } {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = /Portfolio \((Q[1-4] \d{4})\)\s*Published:\s*([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text);
  if (!m) throw new Error("insiderset : trimestre / date de publication introuvables sur la page investisseur");
  return { trimestre: toTrimestre(m[1]), quarter: m[1], depose_le: parseDate(m[2])! };
}
