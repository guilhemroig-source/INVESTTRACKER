import { XMLParser } from "fast-xml-parser";

/** Libellés français des codes de transaction du formulaire 4 (SEC). */
export const FORM4_CODES: Record<string, string> = {
  P: "Achat",
  S: "Vente",
  A: "Attribution d'actions",
  D: "Cession à l'émetteur / annulation",
  G: "Don",
  M: "Exercice d'options",
  X: "Exercice d'options",
  F: "Retenue d'actions (paiement du prix d'exercice ou impôts)",
  C: "Conversion",
  J: "Autre opération",
  W: "Transmission (héritage)",
  I: "Opération discrétionnaire",
  E: "Expiration d'options",
  H: "Expiration d'options",
  K: "Opération sur swap",
  L: "Petite acquisition",
  U: "Apport à une offre publique",
  V: "Déclaration volontaire",
  Z: "Dépôt dans / retrait d'un trust",
};

export interface Form4Tx {
  table: "nonDerivative" | "derivative";
  security: string;
  date: string | null;
  code: string;
  shares: number | null; // non signé, tel que déclaré
  price: number | null;
  acquiredDisposed: "A" | "D" | null;
  ownedAfter: number | null;
  directIndirect: "D" | "I" | null;
  natureOfOwnership: string | null;
  footnoteIds: string[];
}

export interface Form4Owner { cik: string; name: string; roles: string }

export interface Form4Doc {
  documentType: string;
  periodOfReport: string | null;
  issuerCik: string;
  issuerName: string;
  ticker: string;
  owners: Form4Owner[];
  transactions: Form4Tx[];
  footnotes: Record<string, string>;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false, // garder les CIK et codes en texte
  trimValues: true,
  isArray: (name) => ["nonDerivativeTransaction", "derivativeTransaction", "reportingOwner", "footnote", "footnoteId"].includes(name),
});

type Node = Record<string, unknown> | undefined;
const val = (n: unknown): string | null => {
  if (n == null) return null;
  if (typeof n === "string" || typeof n === "number") return String(n);
  const v = (n as Record<string, unknown>).value;
  return v == null || v === "" ? null : String(v);
};
const num = (n: unknown) => { const v = val(n); return v == null ? null : Number(v); };
const isTrue = (n: unknown) => ["1", "true"].includes(String(val(n) ?? n ?? "").toLowerCase());

function collectFootnoteIds(n: unknown, out: Set<string>) {
  if (!n || typeof n !== "object") return;
  for (const [k, v] of Object.entries(n)) {
    if (k === "footnoteId") for (const f of v as Record<string, string>[]) out.add(f["@id"]);
    else collectFootnoteIds(v, out);
  }
}

function parseTx(t: Record<string, Node>, table: Form4Tx["table"]): Form4Tx {
  const amounts = (t.transactionAmounts ?? {}) as Record<string, unknown>;
  const post = (t.postTransactionAmounts ?? {}) as Record<string, unknown>;
  const nature = (t.ownershipNature ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();
  collectFootnoteIds(t, ids);
  const price = num(amounts.transactionPricePerShare);
  return {
    table,
    security: val(t.securityTitle) ?? "",
    date: val(t.transactionDate)?.slice(0, 10) ?? null,
    code: String((t.transactionCoding as Record<string, unknown>)?.transactionCode ?? ""),
    shares: num(amounts.transactionShares),
    price: price != null && Number.isFinite(price) ? price : null,
    acquiredDisposed: (val(amounts.transactionAcquiredDisposedCode) as "A" | "D" | null) ?? null,
    ownedAfter: num(post.sharesOwnedFollowingTransaction),
    directIndirect: (val(nature.directOrIndirectOwnership) as "D" | "I" | null) ?? null,
    natureOfOwnership: val(nature.natureOfOwnership),
    footnoteIds: [...ids],
  };
}

/** Lit le XML d'un formulaire 4 (ou 4/A) déposé sur EDGAR. */
export function parseForm4Xml(text: string): Form4Doc {
  const root = xml.parse(text).ownershipDocument as Record<string, Node>;
  if (!root) throw new Error("XML sans <ownershipDocument> : ce n'est pas un formulaire 4");
  const issuer = (root.issuer ?? {}) as Record<string, unknown>;
  const owners = ((root.reportingOwner ?? []) as Record<string, Record<string, unknown>>[]).map((o) => {
    const id = o.reportingOwnerId ?? {};
    const rel = o.reportingOwnerRelationship ?? {};
    const roles: string[] = [];
    if (isTrue(rel.isOfficer) && rel.officerTitle) roles.push(String(rel.officerTitle));
    else if (isTrue(rel.isOfficer)) roles.push("Dirigeant");
    if (isTrue(rel.isDirector)) roles.push("Dir");
    if (isTrue(rel.isTenPercentOwner)) roles.push("10%");
    if (isTrue(rel.isOther) && rel.otherText) roles.push(String(rel.otherText));
    return { cik: String(id.rptOwnerCik ?? ""), name: String(id.rptOwnerName ?? "").trim(), roles: roles.join(", ") };
  });
  const nd = (root.nonDerivativeTable ?? {}) as Record<string, Record<string, Node>[]>;
  const dv = (root.derivativeTable ?? {}) as Record<string, Record<string, Node>[]>;
  const fn = ((root.footnotes as Record<string, unknown>)?.footnote ?? []) as Record<string, string>[];
  return {
    documentType: String(root.documentType ?? ""),
    periodOfReport: val(root.periodOfReport),
    issuerCik: String(issuer.issuerCik ?? ""),
    issuerName: String(issuer.issuerName ?? ""),
    ticker: String(issuer.issuerTradingSymbol ?? "").trim().toUpperCase(),
    owners,
    transactions: [
      ...(nd.nonDerivativeTransaction ?? []).map((t) => parseTx(t, "nonDerivative")),
      ...(dv.derivativeTransaction ?? []).map((t) => parseTx(t, "derivative")),
    ],
    footnotes: Object.fromEntries(fn.map((f) => [f["@id"], String(f["#text"] ?? "").replace(/\s+/g, " ").trim()])),
  };
}

/** Une ligne affichable : transactions sur actions ordinaires regroupées par (date, code). */
export interface Form4Line {
  date: string | null;
  code: string;
  operation: string;
  quantite: number; // signée : + acquisition, − cession
  prix: number | null; // moyenne pondérée
  montantUsd: number | null; // signé, null si pas de prix
  ownedAfter: number | null;
}

/**
 * Regroupe les transactions non dérivées (effet sur les actions détenues) par date et par code,
 * comme le fait OpenInsider : une vente exécutée en 40 lots devient une ligne au prix moyen pondéré.
 */
/** Codes pour lesquels « actions × prix » est un vrai montant échangé (pas un prix d'exercice d'une attribution). */
export const VALUED_CODES = new Set(["P", "S", "M", "X", "F"]);

export function aggregateForm4(doc: Form4Doc): Form4Line[] {
  const hasExercise = doc.transactions.some((t) => t.code === "M" || t.code === "X");
  const groups = new Map<string, Form4Line & { _valued: number }>();
  for (const t of doc.transactions) {
    if (t.table !== "nonDerivative" || t.shares == null) continue;
    const signed = t.acquiredDisposed === "D" ? -t.shares : t.shares;
    const k = `${t.date}|${t.code}`;
    const g = groups.get(k) ?? {
      date: t.date, code: t.code,
      operation: t.code === "S" && hasExercise ? "Vente (après exercice d'options)" : FORM4_CODES[t.code] ?? `Code ${t.code}`,
      quantite: 0, prix: null, montantUsd: null, ownedAfter: null, _valued: 0,
    };
    g.quantite += signed;
    if (t.price && t.price > 0 && VALUED_CODES.has(t.code)) {
      g.montantUsd = (g.montantUsd ?? 0) + signed * t.price;
      g._valued += Math.abs(signed);
    }
    g.ownedAfter = t.ownedAfter ?? g.ownedAfter;
    groups.set(k, g);
  }
  return [...groups.values()].map(({ _valued, ...g }) => ({
    ...g,
    montantUsd: g.montantUsd == null ? null : Math.round(g.montantUsd),
    prix: g.montantUsd != null && _valued > 0 ? Math.round((Math.abs(g.montantUsd) / _valued) * 10000) / 10000 : null,
  }));
}
