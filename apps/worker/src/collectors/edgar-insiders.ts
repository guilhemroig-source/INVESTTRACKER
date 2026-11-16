import { existingFilings, knownAccessions } from "@tracker/core";
import { CIK, eftsSearch } from "../sec";
import { fetchForm4, filingKeyOf, filingToRows, storeInsiderRows } from "./form4-edgar";
import { MIN_VALUE, isMusk } from "./openinsider";
import { type Collector, daysAgo, isoDate } from "./types";

/**
 * Secours quand OpenInsider est indisponible : lit directement sur EDGAR tous les formulaires 4
 * déposés hier et aujourd'hui (≈ 500 par jour), garde les achats/ventes de plus de 1 M$,
 * et tous les achats/ventes d'initiés de Tesla. Plus lent (une requête par déclaration) mais officiel.
 */
export const collectEdgarInsiders: Collector = async (db) => {
  const hits = await eftsSearch({ forms: "4", start: daysAgo(1), end: isoDate(new Date()), max: 3000 });
  const accessions = knownAccessions(db);
  const filings = existingFilings(db);
  let nouvelles = 0, lues = 0, erreurs = 0;
  for (const hit of hits) {
    if (accessions.has(hit.adsh) || !hit.form.startsWith("4")) continue;
    let f;
    try { f = await fetchForm4(hit); } catch { erreurs++; continue; }
    lues++;
    if (filings.has(filingKeyOf(f)) || isMusk(f.doc.owners[0]?.name ?? "")) continue;
    const isTesla = f.issuerCik.padStart(10, "0") === CIK.TESLA;
    const rows = filingToRows(f, (l) => (l.code === "P" || l.code === "S") && (isTesla || Math.abs(l.montantUsd ?? 0) > MIN_VALUE));
    if (!rows.length) continue;
    nouvelles += storeInsiderRows(db, rows, isTesla ? "tesla" : "gros");
  }
  if (hits.length && erreurs > hits.length / 2) throw new Error(`${erreurs} formulaires 4 illisibles sur ${hits.length}`);
  return { lues, nouvelles, donneesAu: hits.map((h) => h.fileDate).sort().at(-1) ?? null, details: [`${hits.length} déclarations listées, ${lues} lues, ${erreurs} illisibles`] };
};
