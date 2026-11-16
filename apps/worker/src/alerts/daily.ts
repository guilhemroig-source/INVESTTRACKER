import { type Db, getPortfolio, listJournal, next13FDeadline, schema as s, watchMatches } from "@tracker/core";
import { and, desc, gt, gte, inArray, sql } from "drizzle-orm";
import { ALL_ORDER } from "../collectors";

export const MAX_SMS = 600;

/** Sans accents ni caractères hors GSM : « Allègement » -> « Allegement ». */
export const ascii = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\n]/g, "");

/** 2 410 000 -> "2,4M" ; 935 500 -> "936k" ; 7 090 000 000 -> "7,1Md" */
export function short(n: number): string {
  const a = Math.abs(n);
  const f = (x: number, d: number) => x.toFixed(d).replace(".", ",").replace(/,0$/, "");
  if (a >= 1e9) return f(a / 1e9, 1) + "Md";
  if (a >= 1e6) return f(a / 1e6, a >= 1e8 ? 0 : 1) + "M";
  if (a >= 1e3) return Math.round(a / 1e3) + "k";
  return String(Math.round(a));
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const parisDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);

/**
 * Début de la période couverte : dernier SMS quotidien (sinon 24 h avant), ou dernier import du kit s'il est plus récent
 * (des données réimportées ne sont pas des nouveautés).
 */
export function sinceLastDaily(db: Db, now: Date): string {
  const last = db.select().from(s.alerts).where(and(sql`${s.alerts.type} = 'quotidien'`, inArray(s.alerts.statut, ["envoye", "logue"]))).orderBy(desc(s.alerts.id)).get();
  const imp = db.select({ fin: s.collectLog.fin }).from(s.collectLog).where(sql`${s.collectLog.source} LIKE 'import:%'`).orderBy(desc(s.collectLog.id)).get();
  const base = last?.creeLe ?? new Date(now.getTime() - 24 * 3600_000).toISOString();
  return imp?.fin && imp.fin > base ? imp.fin : base;
}

/** Une ligne compte comme « nouvelle d'hier » si elle est arrivée depuis le dernier SMS ET publiée il y a moins de 5 jours. */
const RECENT_DAYS = 5;

/** Événements notables journalisés par les collecteurs (lignes « ! … » du journal) depuis une date. */
export function eventsSince(db: Db, since: string): string[] {
  const rows = db.select({ d: s.collectLog.details }).from(s.collectLog).where(gt(s.collectLog.debut, since)).all();
  const out = new Set<string>();
  for (const r of rows) for (const l of (r.d ?? "").split("\n")) if (l.startsWith("! ")) out.add(l.slice(2));
  return [...out];
}

/** Sources dont la dernière collecte de la période a échoué (sans secours réussi). */
export function failedSources(db: Db, since: string): string[] {
  const rows = db.select().from(s.collectLog).where(gt(s.collectLog.debut, since)).orderBy(s.collectLog.id).all();
  const last = new Map<string, string>();
  for (const r of rows) last.set(r.source, r.statut);
  const out: string[] = [];
  for (const name of ALL_ORDER) {
    const st = last.get(name);
    if (st === "erreur") {
      if (name === "openinsider" && last.get("edgar-insiders") === "ok") out.push("OpenInsider indisponible (secours EDGAR ok)");
      else out.push(`Source ${name} indisponible`);
    }
  }
  if (!rows.length) out.push("Aucune collecte depuis le dernier SMS");
  return out;
}

/** Texte du SMS quotidien de 7h47 : alertes, mouvements de la veille, échéance, sources en panne, lien. */
export function buildDailySms(db: Db, now = new Date()): string {
  const since = sinceLastDaily(db, now);
  const today = parisDate(now);
  const events = eventsSince(db, since);
  const alertes = events.filter((e) => /^Nouveau 13F|^Nouvelle declaration de Trump|^Nouveau formulaire 4 de Musk/.test(e));

  const minPub = new Date(Date.parse(since) - RECENT_DAYS * 86400_000).toISOString().slice(0, 10);
  const fresh = db.select().from(s.operations).where(and(gt(s.operations.creeLe, since), gte(s.operations.datePublication, minPub))).all();
  const top = (rows: typeof fresh) => rows.filter((o) => o.montantUsd != null).sort((a, b) => b.montantUsd! - a.montantUsd!).slice(0, 3)
    .map((o) => `${o.sens === "achat" ? "+" : "-"}${o.ticker} ${short(o.montantUsd!)}`);
  const ark = top(fresh.filter((o) => o.source === "ARK"));
  const ini = top(fresh.filter((o) => o.source === "FORM4"));
  const elus = fresh.filter((o) => o.source === "CONGRES").length;

  const parts: string[] = [`Investisseurs ${ddmm(today)} :`];
  if (alertes.length) parts.push(`ALERTE ${alertes.join(" ; ")}.`);
  const hier: string[] = [];
  if (ark.length) hier.push(`ARK ${ark.join(", ")}`);
  if (ini.length) hier.push(`Inities ${ini.join(", ")}`);
  if (elus) hier.push(`Elus ${elus} nouvelle${elus > 1 ? "s" : ""} transaction${elus > 1 ? "s" : ""}`);
  parts.push(hier.length ? `Hier : ${hier.join(" | ")}.` : "Rien de nouveau hier.");
  // Liste de suivi
  const suivi = watchMatches(db, since, today);
  if (suivi.length) parts.push(`Ta liste : ${suivi.length} mouvement${suivi.length > 1 ? "s" : ""} (${[...new Set(suivi.map((m) => m.ticker))].slice(0, 6).join(", ")}).`);
  // Journal et portefeuille
  const j = listJournal(db, today).stats;
  if (j.aRevoir) parts.push(`Journal : ${j.aRevoir} decision${j.aRevoir > 1 ? "s" : ""} a revoir.`);
  const pf = getPortfolio(db, today);
  if (pf.alertes.length) parts.push(`Portefeuille : ${pf.alertes.length} alerte${pf.alertes.length > 1 ? "s" : ""} (${[...new Set(pf.alertes.map((a) => a.split(" : ")[0]))].slice(0, 4).join(", ")}).`);
  const next = next13FDeadline(today);
  parts.push(`Prochaine echeance : 13F ${next.trimestre} le ${ddmm(next.limite)}.`);
  for (const f of failedSources(db, since)) parts.push(`${f}.`);
  if (process.env.APP_URL) parts.push(process.env.APP_URL);

  let text = ascii(parts.join(" "));
  // Garde-fou de longueur : on raccourcit les alertes, puis on tronque.
  if (text.length > MAX_SMS) text = ascii(parts.map((p) => (p.startsWith("ALERTE") ? `ALERTE ${alertes.length} nouvelle(s) declaration(s), voir l'appli.` : p)).join(" "));
  if (text.length > MAX_SMS) text = text.slice(0, MAX_SMS - 3) + "...";
  return text;
}
