import { existingFilings, knownAccessions, markFilingVerified } from "@tracker/core";
import { CIK, eftsSearch } from "../sec";
import { fetchForm4, filingKeyOf, filingToRows, storeInsiderRows } from "./form4-edgar";
import { type Collector, daysAgo, isoDate } from "./types";

const LIST_BY_ISSUER: Record<string, "tesla" | "spacex"> = { [CIK.TESLA]: "tesla", [CIK.SPACEX]: "spacex" };

/** Tous les formulaires 4 d'Elon Musk (Tesla et SpaceX), lus directement sur EDGAR. */
export const collectEdgarMusk: Collector = async (db) => {
  const hits = await eftsSearch({ q: '"Musk"', forms: "4", ciks: CIK.MUSK, start: daysAgo(730), end: isoDate(new Date()) });
  const accessions = knownAccessions(db);
  const filings = existingFilings(db);
  let nouvelles = 0;
  const evenements: string[] = [], details: string[] = [];
  for (const hit of hits) {
    if (accessions.has(hit.adsh)) continue;
    const f = await fetchForm4(hit);
    const list = LIST_BY_ISSUER[f.issuerCik.padStart(10, "0")];
    if (!list) { details.push(`${hit.adsh} : émetteur ${f.doc.issuerName} non suivi, ignoré`); continue; }
    const key = filingKeyOf(f);
    if (filings.has(key)) {
      // Déjà en base (kit ou OpenInsider) : on garde ces lignes et on y rattache la déclaration officielle.
      markFilingVerified(db, key, hit.adsh, f.humanUrl);
      details.push(`${hit.adsh} (${f.doc.ticker}, ${hit.fileDate}) déjà connu : lien EDGAR rattaché`);
      continue;
    }
    const n = storeInsiderRows(db, filingToRows(f), list);
    nouvelles += n;
    // Seules les déclarations récentes déclenchent une alerte (pas l'historique rattrapé au premier passage).
    if (hit.fileDate >= daysAgo(3)) evenements.push(`Nouveau formulaire 4 de Musk sur ${f.doc.ticker} depose le ${hit.fileDate}`);
    details.push(`${hit.adsh} (${f.doc.ticker}, ${hit.fileDate}) : ${n} ligne(s) ajoutée(s)`);
  }
  return { lues: hits.length, nouvelles, donneesAu: hits.map((h) => h.fileDate).sort().at(-1) ?? null, evenements, details };
};
