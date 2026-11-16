import { desc, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";

/** Tout ce dont le tableau de bord a besoin, en une lecture (quelques centaines de lignes). */
export function getDashboardData(db: Db) {
  const ops = db.select().from(s.operations)
    .orderBy(desc(s.operations.datePublication), desc(s.operations.dateOperation), s.operations.id).all();
  const tickers = Object.fromEntries(db.select().from(s.tickers).all().map((t) => [t.ticker, t.nom]));
  return {
    operations: ops,
    tickers,
    ark: db.select().from(s.rawArk).orderBy(desc(s.rawArk.date), desc(s.rawArk.montantUsd)).all(),
    insiders: db.select().from(s.rawInsider).orderBy(desc(s.rawInsider.deposeLe), desc(s.rawInsider.heureDepot), s.rawInsider.id).all(),
    thirteenF: db.select().from(s.raw13f).all(),
    trump: db.select().from(s.rawTrump).orderBy(desc(s.rawTrump.deposeLe), desc(s.rawTrump.dateTransaction), s.rawTrump.id).all(),
    trumpFilings: db.select().from(s.rawTrumpFilings).orderBy(s.rawTrumpFilings.deposeLe).all(),
    trumpTickers: db.select().from(s.rawTrumpTickers).orderBy(desc(s.rawTrumpTickers.transactions)).all(),
    trumpMeta: db.select().from(s.rawTrumpMeta).get() ?? null,
    congress: db.select().from(s.rawCongress).orderBy(desc(s.rawCongress.dateDeclaration), s.rawCongress.id).all(),
    congressMembers: db.select().from(s.rawCongressMembers).orderBy(desc(s.rawCongressMembers.transactions)).all(),
    sourceStatus: getSourceStatus(db),
    /** Synthèse technique par opération (clé unique → pour / contre / ton). */
    analyses: Object.fromEntries(db.select().from(s.analyses).all().map((a) => [a.cleUnique, { statut: a.statut, pour: a.pour, contre: a.contre, ton: a.ton }])),
  };
}
export type DashboardData = ReturnType<typeof getDashboardData>;

/** Dernière collecte réussie et dernière erreur, par source (pour afficher « données au … »). */
export function getSourceStatus(db: Db) {
  return db.all<{ source: string; dernier_ok: string | null; donnees_au: string | null; derniere_erreur: string | null }>(sql`
    SELECT source,
      MAX(CASE WHEN statut='ok' THEN fin END) AS dernier_ok,
      MAX(CASE WHEN statut='ok' THEN donnees_au END) AS donnees_au,
      MAX(CASE WHEN statut='erreur' THEN fin END) AS derniere_erreur
    FROM collect_log GROUP BY source ORDER BY source`);
}

export function getCollectLog(db: Db, limit = 200) {
  return db.select().from(s.collectLog).orderBy(desc(s.collectLog.id)).limit(limit).all();
}
export function getAlerts(db: Db, limit = 50) {
  return db.select().from(s.alerts).orderBy(desc(s.alerts.id)).limit(limit).all();
}
export function getCounts(db: Db) {
  return db.all<{ source: string; n: number }>(sql`SELECT source, COUNT(*) AS n FROM operations GROUP BY source ORDER BY source`);
}
