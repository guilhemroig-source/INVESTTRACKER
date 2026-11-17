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

export interface Move13F { cusip: string; nameOfIssuer: string; titleOfClass?: string; avant: number; apres: number; variation: number; operation: "Nouvelle position" | "Renforcement" | "Allègement" | "Sortie totale"; variation_pct: number | null }

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
      cusip, nameOfIssuer: (c.get(cusip) ?? p.get(cusip))!.nameOfIssuer, titleOfClass: (c.get(cusip) ?? p.get(cusip))!.titleOfClass, avant, apres, variation: apres - avant, operation,
      variation_pct: avant ? Math.round(((apres - avant) / avant) * 1000) / 10 : null,
    });
  }
  return out.sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation));
}

const ABREV: Record<string, string> = {
  TECHNOLOGIES: "TECH", TECHNOLOGY: "TECH", INTERNATIONAL: "INTL", PHARMACEUTICALS: "PHARM", PHARMACEUTICAL: "PHARM", PHARMA: "PHARM",
  FINANCIAL: "FINL", SYSTEMS: "SYS", COMMUNICATIONS: "COMM", COMMUNICATION: "COMM", ENTERPRISES: "ENTERPRISE", INDUSTRIES: "INDS", INDUSTRY: "INDS",
  SOLUTIONS: "SOLUTION", SERVICES: "SVCS", SERVICE: "SVCS", LABORATORIES: "LABS", RESOURCES: "RES", PROPERTIES: "PPTYS", PETROLEUM: "PETE",
  MANAGEMENT: "MGMT", MATERIALS: "MATLS", MANUFACTURING: "MFG", MINING: "MNG", MINES: "MNG", INVESTMENT: "INVT", INVESTMENTS: "INVT", DEVELOPMENT: "DEV", ENERGY: "ENRG", HEALTHCARE: "HEALTH", AMERICAN: "AMERN", AMERICA: "AMER", NATIONAL: "NATL", BANCORP: "BANCORP", MOTORS: "MTRS",
};
const SUFFIXES = new Set(["INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC", "LP", "LLC", "NV", "SA", "AG", "SE", "HOLDINGS", "HOLDING", "HLDGS", "HLDG",
  "GROUP", "GRP", "THE", "NEW", "DEL", "DE", "COM", "CL", "CLASS", "A", "B", "C", "SHS", "ORD", "ADR", "SPONSORED", "SPON", "TR", "TRUST", "CAP", "STK"]);

/** Clé de rapprochement d'un nom de société : « Coca Cola Co » = « COCA-COLA CO », « Occidental Petroleum Corp /De/ » = « OCCIDENTAL PETE CORP ». */
export function issuerKey(name: string): string {
  return name.toUpperCase().replace(/\(.*?\)/g, " ").replace(/\/[A-Z]{2,3}\/?/g, " ").replace(/\bL\s?P\b/g, " LP ").replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/).filter(Boolean).map((w) => ABREV[w] ?? w).filter((w) => !SUFFIXES.has(w)).join(" ");
}

/** Symbole d'un émetteur de 13F d'après son nom, si un seul symbole connu porte ce nom (sinon null : homonymes, catégories d'actions). */
export function tickerFromIssuer(nameOfIssuer: string, index: Map<string, { ticker: string; cik: string | null }[]>, titleOfClass = ""): string | null {
  const k = issuerKey(nameOfIssuer);
  const cands = k ? index.get(k) ?? [] : [];
  if (cands.length <= 1) return cands[0]?.ticker ?? null;
  // Plusieurs symboles : uniquement s'il s'agit de la même société (même CIK) ; on écarte actions de préférence et variantes (ORCL.PD)
  if (new Set(cands.map((c) => c.cik)).size !== 1 || !cands[0].cik) return null;
  const simples = cands.filter((c) => !c.ticker.includes(".")).sort((a, b) => a.ticker.length - b.ticker.length || a.ticker.localeCompare(b.ticker));
  if (simples.length === 1) return simples[0].ticker;
  // Plusieurs catégories d'actions (GOOG / GOOGL) : on ne devine pas si la ligne précise une catégorie
  if (/\bCL(ASS)?\s*[A-C]\b/i.test(titleOfClass)) return null;
  return simples[0]?.ticker ?? null;
}
export function issuerIndex(tickers: { ticker: string; nom: string; cik?: string | null }[]): Map<string, { ticker: string; cik: string | null }[]> {
  const m = new Map<string, { ticker: string; cik: string | null }[]>();
  for (const t of tickers) { const k = issuerKey(t.nom); if (k) m.set(k, [...(m.get(k) ?? []), { ticker: t.ticker, cik: t.cik ?? null }]); }
  return m;
}

/** "2026-09-30" -> "T3 2026" */
export function trimestreOf(end: string): string {
  const [y, m] = end.split("-").map(Number);
  return `T${Math.ceil(m / 3)} ${y}`;
}
