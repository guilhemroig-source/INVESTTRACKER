import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import { barsOf } from "./analysis-store";
import { getFiche } from "./fiche-store";
import { type PortfolioResult, type PortfolioTx, REGLES_DEFAUT, type Regles, computePortfolio } from "./fiche";
import { canonTicker } from "./parsers/util";

export const REFERENCES: Record<string, string> = { VT: "ETF monde (Vanguard Total World)", SPY: "S&P 500 (SPY)", QQQ: "Nasdaq 100 (QQQ)" };

// ------------------------------------------------------------------ Réglages

export function getRegles(db: Db): Regles & { reference: string } {
  const row = db.select().from(s.settings).where(eq(s.settings.cle, "regles")).get();
  return { ...REGLES_DEFAUT, reference: "VT", ...(row ? JSON.parse(row.valeur) : {}) };
}
export function setRegles(db: Db, r: Partial<Regles & { reference: string }>) {
  const v = { ...getRegles(db), ...r };
  if (!(v.poidsMax > 0 && v.poidsMax <= 1) || !(v.baisseMax > 0 && v.baisseMax < 1) || !REFERENCES[v.reference]) throw new Error("Réglage invalide");
  db.insert(s.settings).values({ cle: "regles", valeur: JSON.stringify(v) }).onConflictDoUpdate({ target: s.settings.cle, set: { valeur: JSON.stringify(v) } }).run();
  return v;
}

/** Dernier cours brut (comparable aux prix payés) d'une action. */
export function lastPrice(db: Db, ticker: string): { cours: number; date: string } | null {
  const r = db.get<{ c: number | null; a: number; d: string }>(sql`SELECT close_brut c, close a, date d FROM prices WHERE ticker = ${ticker} ORDER BY date DESC LIMIT 1`);
  return r ? { cours: r.c ?? r.a, date: r.d } : null;
}

// ------------------------------------------------------------------ Transactions et portefeuille

export function listTx(db: Db) { return db.select().from(s.portfolioTx).orderBy(desc(s.portfolioTx.date), desc(s.portfolioTx.id)).all(); }

export function addTx(db: Db, t: Omit<PortfolioTx, "id">) {
  const ticker = canonTicker(t.ticker ?? "");
  if (!ticker) throw new Error("Symbole manquant");
  if (!["achat", "vente", "dividende"].includes(t.type)) throw new Error("Type inconnu");
  const dt = new Date(`${t.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== t.date) throw new Error("Date invalide (AAAA-MM-JJ)");
  if (t.type !== "dividende" && !(t.quantite > 0)) throw new Error("Quantité invalide");
  if (!(t.prix > 0)) throw new Error(t.type === "dividende" ? "Montant invalide" : "Prix invalide");
  return db.insert(s.portfolioTx).values({ date: t.date, type: t.type, ticker, quantite: t.quantite || 0, prix: t.prix, frais: t.frais || 0, compte: t.compte || "CTO", note: t.note ?? null }).returning().get();
}
export function deleteTx(db: Db, id: number) { db.delete(s.portfolioTx).where(eq(s.portfolioTx.id, id)).run(); }

/** Signaux à surveiller sur une ligne détenue : ventes des investisseurs suivis, décisions du journal à revoir. */
function extraAlerts(db: Db, today: string) {
  return (ticker: string) => {
    const out: string[] = [];
    const since = new Date(Date.parse(today) - 30 * 86400_000).toISOString().slice(0, 10);
    const sellers = db.all<{ qui: string }>(sql`SELECT DISTINCT qui FROM operations WHERE ticker = ${ticker} AND sens = 'vente' AND date_publication >= ${since}
      AND NOT (source = 'FORM4' AND (operation LIKE '%exercice%' OR operation LIKE 'Retenue%' OR operation LIKE 'Don%'))`);
    if (sellers.length) out.push(`Vendue récemment par ${sellers.slice(0, 3).map((x) => x.qui.replace(/\s*\(.*\)$/, "")).join(", ")}${sellers.length > 3 ? "…" : ""}`);
    const due = db.all<{ n: number }>(sql`SELECT COUNT(*) n FROM journal WHERE ticker = ${ticker} AND statut = 'ouverte' AND date_revue IS NOT NULL AND date_revue <= ${today}`)[0]?.n ?? 0;
    if (due) out.push(`${due} décision(s) du journal à revoir`);
    return out;
  };
}

export function getPortfolio(db: Db, today: string): PortfolioResult & { regles: ReturnType<typeof getRegles>; transactions: ReturnType<typeof listTx>; societes: Record<string, string | null> } {
  const regles = getRegles(db);
  const txs = listTx(db);
  const res = computePortfolio(txs as PortfolioTx[], (t) => lastPrice(db, t), { ticker: regles.reference, libelle: REFERENCES[regles.reference], bars: barsOf(db, regles.reference) }, regles, extraAlerts(db, today));
  const societes = Object.fromEntries([...new Set(txs.map((t) => t.ticker))].map((t) => [t, db.select({ n: s.tickers.nom }).from(s.tickers).where(eq(s.tickers.ticker, t)).get()?.n ?? null]));
  return { ...res, regles, transactions: txs, societes };
}

// ------------------------------------------------------------------ Journal de décisions

export type JournalEntry = typeof s.journal.$inferSelect;
export interface JournalInput { date?: string; ticker: string; decision: string; these: string; invalidation?: string | null; objectif?: number | null; prixDecision?: number | null; conviction?: number | null; dateRevue?: string | null }
export const DECISIONS = ["achat", "renforcement", "vente", "allegement", "attendre", "ecarter"] as const;

export function addJournal(db: Db, j: JournalInput, today: string): JournalEntry {
  const ticker = canonTicker(j.ticker ?? "");
  if (!ticker) throw new Error("Symbole manquant");
  if (!DECISIONS.includes(j.decision as (typeof DECISIONS)[number])) throw new Error("Décision inconnue");
  if (!j.these?.trim()) throw new Error("Écrivez votre raisonnement (la thèse)");
  // Contexte figé : ce que montrait l'appli au moment de décider
  const f = getFiche(db, ticker, today);
  const prix = j.prixDecision ?? lastPrice(db, ticker)?.cours ?? null;
  const contexte = {
    score: f.smart.score, acheteurs: f.smart.acheteurs.map((a) => a.acteur), vendeurs: f.smart.vendeurs.map((a) => a.acteur),
    per: f.finances?.per ?? null, croissanceCa: f.finances?.croissanceCa ?? null, volatilite: f.risque.volatilite, distancePlusHaut: f.risque.distancePlusHaut,
  };
  return db.insert(s.journal).values({
    date: j.date ?? today, ticker, decision: j.decision, these: j.these.trim(), invalidation: j.invalidation?.trim() || null, objectif: j.objectif ?? null,
    prixDecision: prix, conviction: j.conviction ?? null, dateRevue: j.dateRevue ?? new Date(Date.parse(today) + 90 * 86400_000).toISOString().slice(0, 10),
    contexte: JSON.stringify(contexte),
  }).returning().get();
}

export function reviewJournal(db: Db, id: number, r: { resultat: string; lecon?: string | null }) {
  if (!["bonne", "mauvaise", "mitigee"].includes(r.resultat)) throw new Error("Résultat inconnu");
  db.update(s.journal).set({ statut: "revue", resultat: r.resultat, lecon: r.lecon?.trim() || null, revueLe: new Date().toISOString() }).where(eq(s.journal.id, id)).run();
}
export function deleteJournal(db: Db, id: number) { db.delete(s.journal).where(eq(s.journal.id, id)).run(); }

export interface JournalView extends JournalEntry {
  coursActuel: number | null; perf: number | null; perfRef: number | null;
  /** Pour un achat : l'action a-t-elle fait mieux que l'ETF de référence ? Pour une vente ou un rejet : moins bien ? */
  verdictAuto: "bonne" | "mauvaise" | null; aRevoir: boolean; refTicker: string;
}

export function listJournal(db: Db, today: string, ticker?: string): { entries: JournalView[]; stats: { total: number; revues: number; aRevoir: number; bonnes: number; mauvaises: number; tauxAuto: number | null } } {
  const ref = getRegles(db).reference;
  const refBars = barsOf(db, ref);
  const atRef = (d: string) => { let r: number | null = null; for (const b of refBars) { if (b.date > d) break; r = b.close; } return r; };
  const refNow = refBars.at(-1)?.close ?? null;
  const rows = (ticker ? db.select().from(s.journal).where(eq(s.journal.ticker, ticker)) : db.select().from(s.journal)).orderBy(desc(s.journal.date), desc(s.journal.id)).all();
  const entries: JournalView[] = rows.map((e) => {
    const now = lastPrice(db, e.ticker)?.cours ?? null;
    const perf = now != null && e.prixDecision ? now / e.prixDecision - 1 : null;
    const r0 = atRef(e.date);
    const perfRef = r0 && refNow ? refNow / r0 - 1 : null;
    const positive = ["achat", "renforcement", "attendre"].includes(e.decision);
    // Pas de verdict avant 7 jours : trop tôt pour juger
    const tropTot = (Date.parse(today) - Date.parse(e.date)) / 86400_000 < 7;
    const verdictAuto = perf == null || perfRef == null || e.decision === "attendre" || tropTot ? null : (positive ? perf > perfRef : perf < perfRef) ? "bonne" : "mauvaise";
    return { ...e, coursActuel: now, perf, perfRef, verdictAuto, aRevoir: e.statut === "ouverte" && !!e.dateRevue && e.dateRevue <= today, refTicker: ref };
  });
  const auto = entries.filter((e) => e.verdictAuto);
  return {
    entries,
    stats: {
      total: entries.length, revues: entries.filter((e) => e.statut === "revue").length, aRevoir: entries.filter((e) => e.aRevoir).length,
      bonnes: entries.filter((e) => e.resultat === "bonne").length, mauvaises: entries.filter((e) => e.resultat === "mauvaise").length,
      tauxAuto: auto.length ? auto.filter((e) => e.verdictAuto === "bonne").length / auto.length : null,
    },
  };
}
