import type { operations } from "../db/schema";

export type NewOperation = typeof operations.$inferInsert;
export type TickerNames = Map<string, string>;

/** Résultat d'un adaptateur : lignes brutes (format source) + lignes unifiées. */
export interface AdapterResult<Raw> {
  raw: Raw[];
  operations: NewOperation[];
}

export const abs = (n: number | null | undefined) => (n == null ? null : Math.abs(n));

/**
 * Ajoute un suffixe #n aux clés identiques dans un même lot : certaines sources
 * (Trump, Congrès) déclarent plusieurs opérations indiscernables le même jour.
 * L'ordre de la source étant stable, la clé reste stable d'une collecte à l'autre.
 */
export function withOrdinal<T>(rows: T[], baseKey: (r: T) => string): { row: T; key: string }[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = baseKey(row);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { row, key: `${base}#${n}` };
  });
}
