import { eq, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import type { NewOperation, TickerNames } from "./adapters/types";
import { canonTicker } from "./parsers/util";

/** Insère en ignorant les doublons (clé unique) ; renvoie le nombre de lignes réellement ajoutées. */
export function insertIgnore<T extends SQLiteTable>(db: Db, table: T, rows: T["$inferInsert"][]): number {
  let added = 0;
  db.transaction((tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      const res = tx.insert(table).values(rows.slice(i, i + 200) as never).onConflictDoNothing().run();
      added += res.changes;
    }
  });
  return added;
}

export const insertOperations = (db: Db, rows: NewOperation[]) => (rows.length ? insertIgnore(db, s.operations, rows) : 0);

export function loadTickerNames(db: Db): TickerNames {
  return new Map(db.select().from(s.tickers).all().map((t) => [t.ticker, t.nom]));
}

/** Ajoute des symboles inconnus (n'écrase jamais un nom existant). */
export function upsertTickers(db: Db, rows: { ticker: string; nom: string | null | undefined; origine: string; cusip?: string | null }[]) {
  const clean = rows.filter((r) => r.ticker && r.nom).map((r) => ({ ticker: canonTicker(r.ticker), nom: r.nom!, origine: r.origine, cusip: r.cusip || null }));
  if (!clean.length) return 0;
  const n = insertIgnore(db, s.tickers, clean);
  // Un CUSIP appris d'une source complète un symbole déjà connu (sert à identifier les lignes des 13F).
  db.transaction((tx) => {
    for (const r of clean) if (r.cusip) tx.update(s.tickers).set({ cusip: r.cusip }).where(sql`${s.tickers.ticker} = ${r.ticker} AND ${s.tickers.cusip} IS NULL`).run();
  });
  return n;
}

/** Complète `societe` sur les opérations dont le nom manquait, une fois la table tickers enrichie. */
export function backfillSocietes(db: Db) {
  db.run(sql`UPDATE operations SET societe = (SELECT nom FROM tickers WHERE tickers.ticker = operations.ticker)
             WHERE societe IS NULL AND EXISTS (SELECT 1 FROM tickers WHERE tickers.ticker = operations.ticker)`);
}

/** Exécute une collecte en la journalisant dans collect_log (succès ou erreur). */
export async function runLogged(
  db: Db,
  source: string,
  fn: () => Promise<{ lues: number; nouvelles: number; donneesAu?: string | null; details?: string[]; evenements?: string[] }>,
) {
  const debut = new Date().toISOString();
  const [{ id }] = db.insert(s.collectLog).values({ source, debut, statut: "en cours" }).returning({ id: s.collectLog.id }).all();
  try {
    const r = await fn();
    db.update(s.collectLog)
      .set({
        fin: new Date().toISOString(), statut: "ok", lignesLues: r.lues, lignesNouvelles: r.nouvelles, donneesAu: r.donneesAu ?? null,
        details: [...(r.evenements ?? []).map((e) => `! ${e}`), ...(r.details ?? [])].join("\n") || null,
      })
      .where(eq(s.collectLog.id, id))
      .run();
    return { ok: true as const, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.update(s.collectLog).set({ fin: new Date().toISOString(), statut: "erreur", erreur: msg }).where(eq(s.collectLog.id, id)).run();
    return { ok: false as const, erreur: msg };
  }
}

/** Déclarations de formulaire 4 déjà en base (clé symbole|déclarant|date de dépôt) avec leur origine. */
export function existingFilings(db: Db): Map<string, { origine: string | null; accession: string | null }> {
  const rows = db.select({ k: s.rawInsider.cleDeclaration, o: s.rawInsider.origine, a: s.rawInsider.accession }).from(s.rawInsider).all();
  const m = new Map<string, { origine: string | null; accession: string | null }>();
  for (const r of rows) if (r.k) m.set(r.k, { origine: r.o, accession: r.a ?? m.get(r.k)?.accession ?? null });
  return m;
}

export function knownAccessions(db: Db): Set<string> {
  return new Set(db.select({ a: s.rawInsider.accession }).from(s.rawInsider).all().map((r) => r.a).filter((a): a is string => !!a));
}

/** Marque une déclaration comme vérifiée sur EDGAR (lignes brutes et unifiées) et y attache son lien officiel. */
export function markFilingVerified(db: Db, cleDeclaration: string, accession: string, url: string) {
  const rows = db.select({ cle: s.rawInsider.cleUnique }).from(s.rawInsider).where(eq(s.rawInsider.cleDeclaration, cleDeclaration)).all();
  db.transaction((tx) => {
    tx.update(s.rawInsider).set({ accession, sourceUrl: url, verifieEdgar: true }).where(eq(s.rawInsider.cleDeclaration, cleDeclaration)).run();
    for (const r of rows) tx.update(s.operations).set({ sourceUrl: url, verifieEdgar: true }).where(eq(s.operations.cleUnique, r.cle)).run();
  });
  return rows.length;
}
