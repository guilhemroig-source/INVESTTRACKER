import { type Db, type InsiderJson, type InsiderList, adaptForm4, aggregateForm4, filingKey, insertIgnore, insertOperations, loadTickerNames, parseForm4Xml, schema as s, type Form4Doc } from "@tracker/core";
import { archiveUrl, getArchive, type EftsHit } from "../sec";

export interface FetchedFiling { hit: EftsHit; doc: Form4Doc; issuerCik: string; xmlUrl: string; humanUrl: string }

/** Télécharge et lit le XML d'un formulaire 4 trouvé par la recherche plein texte. */
export async function fetchForm4(hit: EftsHit): Promise<FetchedFiling> {
  // Le document est rangé sous le CIK de l'émetteur ; on essaie chaque CIK de la déclaration (émetteur en dernier en général).
  let lastErr: unknown;
  for (const cik of [...hit.ciks].reverse()) {
    const xmlUrl = archiveUrl(cik, hit.adsh, hit.file);
    try {
      const doc = parseForm4Xml(await getArchive(xmlUrl));
      const issuerCik = doc.issuerCik || cik;
      return { hit, doc, issuerCik, xmlUrl: archiveUrl(issuerCik, hit.adsh, hit.file), humanUrl: archiveUrl(issuerCik, hit.adsh, hit.file, hit.xsl) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Formulaire 4 ${hit.adsh} illisible`);
}

/** Convertit une déclaration lue sur EDGAR en lignes au format du kit (une par date et code de transaction). */
export function filingToRows(f: FetchedFiling, keep: (l: ReturnType<typeof aggregateForm4>[number]) => boolean = () => true): InsiderJson[] {
  const owner = f.doc.owners[0];
  if (!owner) return [];
  return aggregateForm4(f.doc).filter(keep).map((l) => ({
    depose_le: f.hit.fileDate,
    heure_depot: null,
    date_operation: l.date,
    ticker: f.doc.ticker,
    societe: undefined,
    initie: owner.name,
    fonction: owner.roles || null,
    operation: l.operation,
    code_transaction: l.code,
    prix: l.prix,
    quantite: l.quantite,
    montant_usd: l.montantUsd,
    source: "SEC EDGAR",
    source_url: f.humanUrl,
    accession: f.hit.adsh,
    insider_cik: owner.cik,
  }));
}

/** Insère des lignes de formulaire 4 dans une liste (gros / tesla / spacex) ; renvoie le nombre de nouvelles opérations. */
export function storeInsiderRows(db: Db, rows: InsiderJson[], list: InsiderList): number {
  if (!rows.length) return 0;
  const r = adaptForm4(rows, list, loadTickerNames(db));
  insertIgnore(db, s.rawInsider, r.raw);
  return insertOperations(db, r.operations);
}

export const filingKeyOf = (f: FetchedFiling) => filingKey(f.doc.ticker, f.doc.owners[0]?.name ?? "", f.hit.fileDate);
