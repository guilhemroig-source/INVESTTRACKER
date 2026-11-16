import { XMLParser } from "fast-xml-parser";

export interface Holding13F { cusip: string; nameOfIssuer: string; titleOfClass: string; shares: number; value: number }

const xml = new XMLParser({ removeNSPrefix: true, parseTagValue: false, isArray: (n) => n === "infoTable" });

/**
 * Lit l'« information table » d'un 13F-HR. Les lignes d'un même CUSIP (plusieurs gérants) sont additionnées ;
 * les options (putCall) et les montants en principal d'obligations (PRN) sont exclus.
 */
export function parseInfoTable(text: string): Holding13F[] {
  const root = xml.parse(text).informationTable as { infoTable?: Record<string, unknown>[] } | undefined;
  if (!root) throw new Error("XML sans <informationTable> : ce n'est pas une table 13F");
  const by = new Map<string, Holding13F>();
  for (const r of root.infoTable ?? []) {
    if (r.putCall) continue;
    const sp = r.shrsOrPrnAmt as Record<string, string>;
    if (sp?.sshPrnamtType && sp.sshPrnamtType !== "SH") continue;
    const cusip = String(r.cusip).toUpperCase();
    const h = by.get(cusip) ?? { cusip, nameOfIssuer: String(r.nameOfIssuer), titleOfClass: String(r.titleOfClass ?? ""), shares: 0, value: 0 };
    h.shares += Number(sp?.sshPrnamt ?? 0);
    h.value += Number(r.value ?? 0);
    by.set(cusip, h);
  }
  return [...by.values()];
}

export interface Move13F { cusip: string; nameOfIssuer: string; avant: number; apres: number; variation: number; operation: "Nouvelle position" | "Renforcement" | "Allègement" | "Sortie totale"; variation_pct: number | null }

/** Mouvements entre deux trimestres consécutifs, par différence du nombre d'actions détenues. */
export function diff13F(prev: Holding13F[], cur: Holding13F[]): Move13F[] {
  const p = new Map(prev.map((h) => [h.cusip, h]));
  const c = new Map(cur.map((h) => [h.cusip, h]));
  const out: Move13F[] = [];
  for (const cusip of new Set([...p.keys(), ...c.keys()])) {
    const avant = p.get(cusip)?.shares ?? 0, apres = c.get(cusip)?.shares ?? 0;
    if (avant === apres) continue;
    const operation = avant === 0 ? "Nouvelle position" : apres === 0 ? "Sortie totale" : apres > avant ? "Renforcement" : "Allègement";
    out.push({
      cusip, nameOfIssuer: (c.get(cusip) ?? p.get(cusip))!.nameOfIssuer, avant, apres, variation: apres - avant, operation,
      variation_pct: avant ? Math.round(((apres - avant) / avant) * 1000) / 10 : null,
    });
  }
  return out.sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation));
}
