import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import { acteurOf, isCompensation } from "./fiche";
import { getClassement } from "./fiche-store";

export type WatchRule = typeof s.watchlist.$inferSelect;
export type WatchInput = { type: "action" | "investisseur" | "score"; valeur: string; sens?: "tous" | "achat" | "vente" };

export function listWatch(db: Db): WatchRule[] {
  return db.select().from(s.watchlist).orderBy(desc(s.watchlist.id)).all();
}

export function addWatch(db: Db, w: WatchInput): WatchRule {
  if (!["action", "investisseur", "score"].includes(w.type)) throw new Error("Type de suivi inconnu");
  const valeur = w.type === "action" ? w.valeur.trim().toUpperCase().replace(/[-/ ]/g, ".") : w.valeur.trim();
  if (!valeur) throw new Error("Valeur manquante");
  if (w.type === "score" && !(Number(valeur) > 0 && Number(valeur) <= 100)) throw new Error("Le seuil de score doit être compris entre 1 et 100");
  const existing = db.select().from(s.watchlist).where(and(eq(s.watchlist.type, w.type), eq(s.watchlist.valeur, valeur))).get();
  if (existing) return existing;
  return db.insert(s.watchlist).values({ type: w.type, valeur, sens: w.sens ?? "tous" }).returning().get();
}

export function removeWatch(db: Db, id: number) {
  db.delete(s.watchlist).where(eq(s.watchlist.id, id)).run();
}

export type Op = typeof s.operations.$inferSelect;
export interface WatchMatch { rule: WatchRule; op?: Op; ticker: string; texte: string }

/** L'opération correspond-elle à la règle ? (les ventes de rémunération ne déclenchent pas d'alerte « investisseur ») */
export function matches(rule: WatchRule, o: Op): boolean {
  if (!rule.actif || rule.type === "score") return false;
  if (rule.sens !== "tous" && o.sens !== rule.sens) return false;
  if (rule.type === "action") return o.ticker === rule.valeur;
  return acteurOf(o) === rule.valeur && !isCompensation(o);
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const describeOp = (o: Op) => `${acteurOf(o)} ${o.operation} ${o.ticker} (publie ${ddmm(o.datePublication)})`;

/** Opérations arrivées depuis `since` qui correspondent à la liste de suivi (+ actions dont le score franchit un seuil). */
export function watchMatches(db: Db, since: string, today: string): WatchMatch[] {
  const rules = listWatch(db).filter((r) => r.actif);
  if (!rules.length) return [];
  const fresh = db.select().from(s.operations).where(gt(s.operations.creeLe, since)).all();
  const out: WatchMatch[] = [];
  for (const r of rules) for (const o of fresh) if (matches(r, o)) out.push({ rule: r, op: o, ticker: o.ticker, texte: describeOp(o) });
  // Seuils de score : seulement pour les actions concernées par une nouvelle opération
  const scoreRules = rules.filter((r) => r.type === "score");
  if (scoreRules.length && fresh.length) {
    const touched = new Set(fresh.map((o) => o.ticker));
    for (const row of getClassement(db, today).filter((x) => touched.has(x.ticker))) {
      for (const r of scoreRules) if (row.score >= Number(r.valeur)) out.push({ rule: r, ticker: row.ticker, texte: `${row.ticker} atteint un score smart money de ${row.score}/100` });
    }
  }
  return out;
}

/** Fil des opérations de la liste de suivi (onglet « Ma liste »), les plus récentes d'abord. */
export function watchFeed(db: Db, limit = 200): Op[] {
  const rules = listWatch(db).filter((r) => r.actif && r.type !== "score");
  if (!rules.length) return [];
  return db.select().from(s.operations).orderBy(desc(s.operations.datePublication), desc(s.operations.id)).all()
    .filter((o) => rules.some((r) => matches(r, o))).slice(0, limit);
}

export function getWatchState(db: Db): string | null {
  return db.select().from(s.watchState).where(eq(s.watchState.id, 1)).get()?.dernierPassage ?? null;
}
export function setWatchState(db: Db, iso: string) {
  db.insert(s.watchState).values({ id: 1, dernierPassage: iso }).onConflictDoUpdate({ target: s.watchState.id, set: { dernierPassage: iso } }).run();
}
