import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import { barsOf } from "./analysis-store";
import { getFiche } from "./fiche-store";
import { COMPTES, DEVISES, type PortfolioResult, type PortfolioTx, REGLES_DEFAUT, type Regles, computePortfolio } from "./fiche";
import { canonTicker } from "./parsers/util";

export const REFERENCES: Record<string, string> = { VT: "ETF monde (Vanguard Total World)", SPY: "S&P 500 (SPY)", QQQ: "Nasdaq 100 (QQQ)" };

// ------------------------------------------------------------------ Réglages

export type ReglesPortefeuille = Regles & { reference: string; devise: string };
export function getRegles(db: Db): ReglesPortefeuille {
  const row = db.select().from(s.settings).where(eq(s.settings.cle, "regles")).get();
  return { ...REGLES_DEFAUT, reference: "VT", devise: "EUR", ...(row ? JSON.parse(row.valeur) : {}) };
}
export function setRegles(db: Db, r: Partial<ReglesPortefeuille>) {
  const v = { ...getRegles(db), ...r };
  if (!(v.poidsMax > 0 && v.poidsMax <= 1) || !(v.baisseMax > 0 && v.baisseMax < 1) || !REFERENCES[v.reference] || !(DEVISES as readonly string[]).includes(v.devise)) throw new Error("Réglage invalide");
  db.insert(s.settings).values({ cle: "regles", valeur: JSON.stringify(v) }).onConflictDoUpdate({ target: s.settings.cle, set: { valeur: JSON.stringify(v) } }).run();
  return v;
}

// ------------------------------------------------------------------ Change (BCE)

/** Taux BCE (dollars pour 1 euro) au jour donné ou au dernier jour ouvré précédent ; null si aucun taux connu. */
export function fxTable(db: Db) {
  const rows = db.select().from(s.change).orderBy(s.change.date).all();
  const at = (date: string): number | null => {
    if (!rows.length) return null;
    let lo = 0, hi = rows.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { r = m; lo = m + 1; } else hi = m - 1; }
    if (r >= 0) return rows[r].eurusd;
    // Date antérieure au premier taux connu : toléré à 10 jours près, sinon inconnu
    return Date.parse(rows[0].date) - Date.parse(date) <= 10 * 86400_000 ? rows[0].eurusd : null;
  };
  /** Convertit un montant ; null si le taux du jour manque. */
  const convert = (montant: number, de: string, vers: string, date: string): number | null => {
    if (de === vers) return montant;
    const r = at(date);
    if (!r) return null;
    return de === "USD" && vers === "EUR" ? montant / r : de === "EUR" && vers === "USD" ? montant * r : null;
  };
  return { at, convert, dernier: rows.at(-1) ?? null, vide: !rows.length };
}
export type Fx = ReturnType<typeof fxTable>;

// ------------------------------------------------------------------ Cours

/** Dernier cours brut (comparable aux prix payés) d'une action, en dollars. */
export function lastPrice(db: Db, ticker: string): { cours: number; date: string } | null {
  const r = db.get<{ c: number | null; a: number; d: string }>(sql`SELECT close_brut c, close a, date d FROM prices WHERE ticker = ${ticker} ORDER BY date DESC LIMIT 1`);
  return r ? { cours: r.c ?? r.a, date: r.d } : null;
}

export type ActifPerso = typeof s.actifsPerso.$inferSelect;
export function listActifs(db: Db): ActifPerso[] { return db.select().from(s.actifsPerso).all(); }

/** Déclare (ou met à jour) un actif hors actions américaines : ETF européen, action française, fonds non coté, crypto. */
export function upsertActif(db: Db, a: { ticker: string; nom: string; devise?: string; cotation?: string; indice?: string | null; peaEligible?: boolean; note?: string | null }): ActifPerso {
  const ticker = canonTicker(a.ticker ?? "");
  if (!ticker || !a.nom?.trim()) throw new Error("Symbole et nom requis");
  const v = { ticker, nom: a.nom.trim(), devise: a.devise ?? "EUR", cotation: a.cotation ?? "manuel", indice: a.indice ? a.indice.trim() : null, peaEligible: !!a.peaEligible, note: a.note ?? null };
  if (!(DEVISES as readonly string[]).includes(v.devise) || !["manuel", "crypto"].includes(v.cotation)) throw new Error("Devise ou cotation inconnue");
  db.insert(s.actifsPerso).values(v).onConflictDoUpdate({ target: s.actifsPerso.ticker, set: v }).run();
  return v;
}

/** Enregistre un cours saisi à la main (remplace celui du même jour). */
export function addCoursManuel(db: Db, c: { ticker: string; date: string; cours: number; devise?: string }) {
  const ticker = canonTicker(c.ticker ?? "");
  if (!ticker || !(c.cours > 0) || !isoValide(c.date)) throw new Error("Cours manuel invalide");
  const v = { ticker, date: c.date, cours: c.cours, devise: c.devise ?? db.select({ d: s.actifsPerso.devise }).from(s.actifsPerso).where(eq(s.actifsPerso.ticker, ticker)).get()?.d ?? "EUR" };
  db.insert(s.coursManuels).values(v).onConflictDoUpdate({ target: [s.coursManuels.ticker, s.coursManuels.date], set: { cours: v.cours, devise: v.devise } }).run();
  return v;
}

export interface Cote { cours: number; date: string; devise: string; source: "marche" | "manuel" | "indice"; indice?: string; saisiLe?: string }

/**
 * Cours actuel d'un actif, dans sa devise :
 *  - action américaine ou crypto : dernier cours Tiingo (dollars), sauf saisie manuelle plus récente ;
 *  - actif « manuel » : dernière saisie, prolongée par la variation de l'indice associé (cours ajustés, dividendes réinvestis).
 */
export function quoteOf(db: Db, ticker: string, fx: Fx, actif = db.select().from(s.actifsPerso).where(eq(s.actifsPerso.ticker, ticker)).get()): Cote | null {
  const manuel = db.select().from(s.coursManuels).where(eq(s.coursManuels.ticker, ticker)).orderBy(desc(s.coursManuels.date)).get();
  if (actif?.cotation === "manuel") {
    if (!manuel) return null;
    if (actif.indice) {
      const bars = barsOf(db, actif.indice);
      const ancre = [...bars].reverse().find((b) => b.date <= manuel.date), fin = bars.at(-1);
      if (ancre && fin && fin.date > manuel.date) {
        const p0 = fx.convert(ancre.close, "USD", manuel.devise, ancre.date), p1 = fx.convert(fin.close, "USD", manuel.devise, fin.date);
        if (p0 && p1) return { cours: manuel.cours * (p1 / p0), date: fin.date, devise: manuel.devise, source: "indice", indice: actif.indice, saisiLe: manuel.date };
      }
    }
    return { cours: manuel.cours, date: manuel.date, devise: manuel.devise, source: "manuel", saisiLe: manuel.date };
  }
  const marche = lastPrice(db, ticker);
  if (manuel && (!marche || manuel.date > marche.date)) return { cours: manuel.cours, date: manuel.date, devise: manuel.devise, source: "manuel", saisiLe: manuel.date };
  return marche ? { ...marche, devise: "USD", source: "marche" } : null;
}

const isoValide = (d: string) => {
  const dt = new Date(`${d}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(d ?? "") && !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
};

// ------------------------------------------------------------------ Transactions et portefeuille

export function listTx(db: Db) { return db.select().from(s.portfolioTx).orderBy(desc(s.portfolioTx.date), desc(s.portfolioTx.id)).all(); }

export function addTx(db: Db, t: Omit<PortfolioTx, "id">) {
  const ticker = canonTicker(t.ticker ?? "");
  if (!ticker) throw new Error("Symbole manquant");
  if (!["achat", "vente", "dividende"].includes(t.type)) throw new Error("Type inconnu");
  if (!isoValide(t.date)) throw new Error("Date invalide (AAAA-MM-JJ)");
  if (t.type !== "dividende" && !(t.quantite > 0)) throw new Error("Quantité invalide");
  if (!(t.prix > 0)) throw new Error(t.type === "dividende" ? "Montant invalide" : "Prix invalide");
  const compte = t.compte || "CTO", devise = t.devise || "USD";
  if (!(COMPTES as readonly string[]).includes(compte)) throw new Error("Compte inconnu");
  if (!(DEVISES as readonly string[]).includes(devise)) throw new Error("Devise inconnue");
  return db.insert(s.portfolioTx).values({ date: t.date, type: t.type, ticker, quantite: t.quantite || 0, prix: t.prix, frais: t.frais || 0, compte, devise, note: t.note ?? null }).returning().get();
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

export type PortfolioView = PortfolioResult & {
  regles: ReglesPortefeuille; devise: string; transactions: ReturnType<typeof listTx>; societes: Record<string, string | null>;
  cotes: Record<string, Cote | null>; avertissements: string[]; change: { date: string; eurusd: number } | null;
  enAttente: LigneImport[];
};

/** Portefeuille calculé dans la devise choisie (euros par défaut) : chaque flux converti au taux BCE de son jour, les cours au taux du jour du cours. */
export function getPortfolio(db: Db, today: string): PortfolioView {
  const regles = getRegles(db);
  const D = regles.devise;
  const fx = fxTable(db);
  const txs = listTx(db);
  const actifs = new Map(listActifs(db).map((a) => [a.ticker, a]));
  const avertissements: string[] = [];

  const conv: PortfolioTx[] = [];
  let sansTaux = 0;
  for (const t of txs) {
    const prix = fx.convert(t.prix, t.devise, D, t.date), frais = fx.convert(t.frais, t.devise, D, t.date);
    if (prix == null || frais == null) { sansTaux++; continue; }
    conv.push({ ...(t as PortfolioTx), prix, frais });
  }
  if (sansTaux) avertissements.push(`${sansTaux} transaction(s) ignorée(s) : taux de change BCE pas encore téléchargé (collecteur « change »).`);

  const cotes: Record<string, Cote | null> = {};
  const cours = (t: string) => {
    const q = (cotes[t] ??= quoteOf(db, t, fx, actifs.get(t)));
    if (!q) return null;
    const c = fx.convert(q.cours, q.devise, D, q.date);
    return c == null ? null : { cours: c, date: q.date };
  };
  // ETF de référence (coté en dollars) converti dans la devise du portefeuille, jour par jour
  const refBars = barsOf(db, regles.reference).flatMap((b) => {
    if (D === "USD") return [b];
    const c = fx.convert(b.close, "USD", D, b.date);
    return c == null ? [] : [{ ...b, open: c, high: c, low: c, close: c }];
  });
  const extra = extraAlerts(db, today);
  const res = computePortfolio(conv, cours, { ticker: regles.reference, libelle: REFERENCES[regles.reference], bars: refBars }, regles, (t) => {
    const out = extra(t);
    const a = actifs.get(t);
    if (a?.cotation === "manuel" && cotes[t]?.source === "manuel" && cotes[t]!.date < new Date(Date.parse(today) - 31 * 86400_000).toISOString().slice(0, 10)) out.unshift(`Cours saisi le ${cotes[t]!.date} : à mettre à jour`);
    return out;
  });
  // Éligibilité PEA : seuls les actifs déclarés éligibles (les actions américaines ne le sont pas)
  for (const p of res.positions) {
    if (p.compte === "PEA" && p.quantite > 0 && !actifs.get(p.ticker)?.peaEligible) {
      const msg = actifs.has(p.ticker) ? "Non déclaré éligible au PEA (vérifiez le compte)" : "Action américaine : non éligible au PEA (vérifiez le compte)";
      p.alertes.unshift(msg); res.alertes.unshift(`${p.ticker} : ${msg}`);
    }
  }
  const nom = (t: string) => actifs.get(t)?.nom ?? db.select({ n: s.tickers.nom }).from(s.tickers).where(eq(s.tickers.ticker, t)).get()?.n ?? null;
  const societes = Object.fromEntries([...new Set(txs.map((t) => t.ticker))].map((t) => [t, nom(t)]));
  return { ...res, regles, devise: D, transactions: txs, societes, cotes, avertissements, change: fx.dernier, enAttente: importsEnAttente(db) };
}

// ------------------------------------------------------------------ Mes points d'entrée (graphiques)

export interface MesEntrees {
  transactions: { date: string; type: "achat" | "vente"; quantite: number; prix: number; devise: string; prixUsd: number | null; compte: string }[];
  /** Prix de revient converti en dollars au dernier taux connu : le cours à dépasser pour être gagnant dans la devise du portefeuille */
  prixRevientUsd: number | null; prixRevient: number | null; devise: string; quantite: number;
}

/** Achats et ventes d'une action de mon portefeuille, en dollars (devise des graphiques), et mon prix de revient. */
export function mesEntrees(db: Db, ticker: string, today: string): MesEntrees | null {
  const txs = listTx(db).filter((t) => t.ticker === ticker && t.type !== "dividende");
  if (!txs.length) return null;
  const fx = fxTable(db);
  const pf = getPortfolio(db, today);
  const pos = pf.positions.filter((p) => p.ticker === ticker && p.quantite > 0);
  const q = pos.reduce((a, p) => a + p.quantite, 0);
  const pru = q ? pos.reduce((a, p) => a + p.pru * p.quantite, 0) / q : null;
  const ref = fx.dernier?.date ?? today;
  return {
    transactions: txs.map((t) => ({ date: t.date, type: t.type as "achat" | "vente", quantite: t.quantite, prix: t.prix, devise: t.devise, prixUsd: fx.convert(t.prix, t.devise, "USD", t.date), compte: t.compte }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    prixRevient: pru, devise: pf.devise, quantite: q,
    prixRevientUsd: pru != null ? fx.convert(pru, pf.devise, "USD", ref) : null,
  };
}

// ------------------------------------------------------------------ Import depuis l'appli d'un courtier

/**
 * Ligne telle qu'affichée par l'appli du courtier : valeur actuelle et plus-value « depuis l'achat » (en montant ou en %).
 * Le serveur en déduit le prix de revient, la quantité (valeur ÷ cours du jour) et, faute de date connue,
 * la date d'achat la plus récente où le cours valait ce prix de revient.
 */
export interface LigneImport {
  ticker: string; nom?: string; compte: string; valeur: number; gain?: number | null; gainPct?: number | null;
  cotation?: "marche" | "manuel" | "crypto"; indice?: string | null; peaEligible?: boolean;
  date?: string | null; releveLe?: string; source?: string;
}
const CLE_IMPORT = "imports_en_attente";
export function importsEnAttente(db: Db): LigneImport[] {
  const r = db.select().from(s.settings).where(eq(s.settings.cle, CLE_IMPORT)).get();
  return r ? JSON.parse(r.valeur) : [];
}
function setEnAttente(db: Db, l: LigneImport[]) {
  const v = JSON.stringify(l);
  db.insert(s.settings).values({ cle: CLE_IMPORT, valeur: v }).onConflictDoUpdate({ target: s.settings.cle, set: { valeur: v } }).run();
}

/** Date la plus récente (avant le relevé) où le cours, converti en euros, était à moins de 1,5 % du prix visé. */
export function estimerDateAchat(bars: { date: string; close: number }[], prix: number, avant: string): string | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date > avant) continue;
    if (Math.abs(bars[i].close / prix - 1) <= 0.015) return bars[i].date;
  }
  return null;
}

type Resultat = { ticker: string; statut: "importee" | "en attente" | "erreur"; detail: string };

function traiterLigne(db: Db, l: LigneImport, fx: Fx): Resultat {
  const ticker = canonTicker(l.ticker ?? "");
  const releve = l.releveLe!;
  const cout = l.gain != null ? l.valeur - l.gain : l.gainPct != null ? l.valeur / (1 + l.gainPct) : null;
  if (!ticker || !(l.valeur > 0) || !(cout && cout > 0)) return { ticker, statut: "erreur", detail: "valeur ou plus-value manquante" };
  const cotation = l.cotation ?? "marche";
  if (cotation !== "marche") upsertActif(db, { ticker, nom: l.nom ?? ticker, devise: cotation === "crypto" ? "USD" : "EUR", cotation, indice: l.indice ?? null, peaEligible: l.peaEligible });
  const note = (q: string, d: string) => `Importé de ${l.source ?? "l'appli du courtier"} (relevé du ${releve} : valeur ${l.valeur.toFixed(2)} €, plus-value ${(l.valeur - cout).toFixed(2)} €). ${q}${d}`;
  const eur = (bars: { date: string; close: number }[]) => bars.flatMap((b) => { const c = fx.convert(b.close, "USD", "EUR", b.date); return c == null ? [] : [{ date: b.date, close: c }]; });

  if (cotation === "manuel") {
    addCoursManuel(db, { ticker, date: releve, cours: l.valeur, devise: "EUR" });
    // Date : donnée, ou estimée sur l'indice (le cours visé est le cours relevé ramené au prix de revient)
    let date = l.date ?? null, dEst = "";
    if (!date && l.indice) {
      const b = eur(barsOf(db, l.indice).map((x) => ({ date: x.date, close: x.close })));
      const fin = [...b].reverse().find((x) => x.date <= releve);
      date = fin ? estimerDateAchat(b, fin.close * (cout / l.valeur), releve) : null;
      if (date) dEst = ` Date d'achat estimée d'après ${l.indice}.`;
    }
    if (!date) { date = releve; dEst = " Date d'achat inconnue : à corriger."; }
    addTx(db, { date, type: "achat", ticker, quantite: 1, prix: cout, frais: 0, compte: l.compte, devise: "EUR", note: note("Ligne entière comptée comme 1 lot.", dEst) });
    return { ticker, statut: "importee", detail: `1 lot, prix de revient ${cout.toFixed(2)} €` };
  }

  // Cotée (action américaine ou crypto) : il faut le cours du jour du relevé, en euros
  const q = quoteOf(db, ticker, fx);
  const tropVieux = !q || Date.parse(releve) - Date.parse(q.date) > 5 * 86400_000;
  const prixJour = q && !tropVieux ? fx.convert(q.cours, q.devise, "EUR", q.date) : null;
  if (prixJour == null) return { ticker, statut: "en attente", detail: tropVieux ? "cours pas encore téléchargé" : "taux de change BCE manquant" };
  const quantite = l.valeur / prixJour, pru = cout / quantite;
  let date = l.date ?? null, dEst = "";
  if (!date) {
    date = estimerDateAchat(eur(db.all<{ date: string; close: number }>(sql`SELECT date, COALESCE(close_brut, close) close FROM prices WHERE ticker = ${ticker} ORDER BY date`)), pru, releve);
    dEst = date ? " Date d'achat estimée (dernier jour où le cours valait le prix de revient)." : "";
  }
  if (!date) { date = releve; dEst = " Date d'achat inconnue : à corriger."; }
  addTx(db, { date, type: "achat", ticker, quantite: Math.round(quantite * 1e6) / 1e6, prix: pru, frais: 0, compte: l.compte, devise: "EUR", note: note(`Quantité déduite du cours du ${q!.date}.`, dEst) });
  return { ticker, statut: "importee", detail: `${quantite.toFixed(4)} à ${pru.toFixed(2)} €` };
}

/** Importe des lignes ; celles dont le cours manque restent en attente et sont reprises après chaque collecte de cours. */
export function importLignes(db: Db, lignes: LigneImport[], today: string): Resultat[] {
  const fx = fxTable(db);
  const attente = importsEnAttente(db);
  const out: Resultat[] = [];
  for (const l0 of lignes) {
    const l = { ...l0, releveLe: l0.releveLe ?? today, compte: l0.compte || "CTO" };
    if (!(COMPTES as readonly string[]).includes(l.compte)) { out.push({ ticker: l.ticker, statut: "erreur", detail: "compte inconnu" }); continue; }
    const r = traiterLigne(db, l, fx);
    if (r.statut === "en attente") attente.push(l);
    out.push(r);
  }
  setEnAttente(db, attente);
  return out;
}

/** Reprend les lignes en attente (appelé après la collecte des cours et à l'ouverture du portefeuille). */
export function processImports(db: Db): Resultat[] {
  const attente = importsEnAttente(db);
  if (!attente.length) return [];
  const fx = fxTable(db);
  const reste: LigneImport[] = [], out: Resultat[] = [];
  for (const l of attente) {
    const r = traiterLigne(db, l, fx);
    if (r.statut === "en attente") reste.push(l);
    out.push(r);
  }
  setEnAttente(db, reste);
  return out;
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
