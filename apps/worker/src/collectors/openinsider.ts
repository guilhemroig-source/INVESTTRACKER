import { type Db, type InsiderJson, type OpenInsiderRow, existingFilings, filingKey, markFilingVerified, openInsiderOperation, parseOpenInsiderTable, personKey } from "@tracker/core";
import { getText } from "../http";
import { TOOL_UA } from "../env";
import { eftsSearch } from "../sec";
import { fetchForm4, filingKeyOf, storeInsiderRows } from "./form4-edgar";
import type { Collector } from "./types";

export const OI_LATEST = "http://openinsider.com/latest-insider-trading";
export const OI_TESLA = "http://openinsider.com/screener?s=TSLA&fd=730&xp=1&xs=1&cnt=100";
export const MIN_VALUE = 1_000_000;

const toJson = (r: OpenInsiderRow): InsiderJson => ({
  depose_le: r.depose_le, heure_depot: r.heure_depot, date_operation: r.date_operation, ticker: r.ticker, societe: r.societe ?? undefined,
  initie: r.initie, fonction: r.fonction, operation: r.operation, prix: r.prix, quantite: r.quantite, montant_usd: r.montant_usd,
  source: "OpenInsider", source_url: r.sec_url, insider_cik: r.insider_cik,
  accession: r.sec_url ? /(\d{10}-\d{2}-\d{6})/.exec(r.sec_url)?.[1] ?? null : null,
});

/** Retire les déclarations déjà importées depuis EDGAR (EDGAR fait foi). */
function withoutEdgarFilings(db: Db, rows: OpenInsiderRow[]) {
  const filings = existingFilings(db);
  return rows.filter((r) => !isMusk(r.initie) && !/edgar/i.test(filings.get(filingKey(r.ticker, r.initie, r.depose_le))?.origine ?? ""));
}

/** Musk est collecté exclusivement sur EDGAR (collecteur edgar-musk), avec attributions, dons et exercices. */
export const isMusk = (name: string) => personKey(name) === "elon musk";

/**
 * Vérifie une ligne OpenInsider sur EDGAR : retrouve le formulaire 4 du déclarant ce jour-là
 * et compare le nombre d'actions (achats / ventes regroupés). Renvoie true si concordant.
 */
export async function verifyOnEdgar(db: Db, r: OpenInsiderRow): Promise<string> {
  if (!r.insider_cik) return `${r.ticker} ${r.initie} : CIK du déclarant inconnu, vérification impossible`;
  const hits = await eftsSearch({ forms: "4", ciks: r.insider_cik.padStart(10, "0"), start: r.depose_le, end: r.depose_le, max: 100 });
  for (const hit of hits) {
    const f = await fetchForm4(hit);
    if (f.doc.ticker !== r.ticker) continue;
    const code = /^P/.test(r.type) ? "P" : "S";
    const qty = f.doc.transactions
      .filter((t) => t.table === "nonDerivative" && t.code === code && t.shares != null)
      .reduce((a, t) => a + (t.acquiredDisposed === "D" ? -t.shares! : t.shares!), 0);
    if (r.quantite != null && Math.abs(qty - r.quantite) <= 1) {
      markFilingVerified(db, filingKeyOf(f), hit.adsh, f.humanUrl);
      return `${r.ticker} ${r.initie} : vérifié sur EDGAR (${hit.adsh}, ${qty} actions)`;
    }
    return `${r.ticker} ${r.initie} : ÉCART EDGAR ${qty} actions contre ${r.quantite} chez OpenInsider (${hit.adsh})`;
  }
  return `${r.ticker} ${r.initie} : aucun formulaire 4 trouvé sur EDGAR le ${r.depose_le}`;
}

/** OpenInsider : gros mouvements du jour (> 1 M$) + tous les achats/ventes des initiés de Tesla. Puis vérification EDGAR des 2 plus gros. */
export const collectOpenInsider: Collector = async (db) => {
  const latest = parseOpenInsiderTable(await getText(OI_LATEST, { userAgent: TOOL_UA, cacheTtl: 0 }))
    .filter((r) => openInsiderOperation(r.type) && Math.abs(r.montant_usd ?? 0) > MIN_VALUE);
  const tesla = parseOpenInsiderTable(await getText(OI_TESLA, { userAgent: TOOL_UA, cacheTtl: 0 }))
    .filter((r) => openInsiderOperation(r.type) && r.ticker === "TSLA");

  let nouvelles = storeInsiderRows(db, withoutEdgarFilings(db, latest).map(toJson), "gros");
  nouvelles += storeInsiderRows(db, withoutEdgarFilings(db, tesla).map(toJson), "tesla");

  // (c) vérification sur EDGAR des 2 plus gros mouvements du jour le plus récent
  const lastDay = latest.map((r) => r.depose_le).sort().at(-1);
  const top = latest.filter((r) => r.depose_le === lastDay).sort((a, b) => Math.abs(b.montant_usd ?? 0) - Math.abs(a.montant_usd ?? 0));
  const seen = new Set<string>();
  const details: string[] = [];
  for (const r of top) {
    const k = `${r.ticker}|${personKey(r.initie)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    try { details.push(await verifyOnEdgar(db, r)); } catch (e) { details.push(`${r.ticker} : vérification EDGAR en échec (${(e as Error).message})`); }
    if (seen.size >= 2) break;
  }
  return { lues: latest.length + tesla.length, nouvelles, donneesAu: lastDay ?? null, details };
};
