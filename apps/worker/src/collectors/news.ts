import { type Db, classify, classify8K, ITEMS_8K_MAJEURS, schema as s, shortName } from "@tracker/core";
export { shortName };
import { and, eq, sql } from "drizzle-orm";
import { HttpError, getText } from "../http";
import { TOOL_UA } from "../env";
import { archiveUrl, eftsSearch, getArchive } from "../sec";
import { type Collector, daysAgo, isoDate } from "./types";

/**
 * Nouvelles autour de chaque opération :
 * - annonces officielles : formulaires 8-K de la société sur EDGAR (rubriques + phrase d'annonce) ;
 * - presse : articles indexés par GDELT (gratuit, sans clé ; archive limitée aux 3 derniers mois ; 1 requête / 5 s).
 * Opérations les plus récentes d'abord ; chaque fenêtre n'est interrogée qu'une fois.
 */
const DAY = 86400_000;
const shift = (iso: string, n: number) => isoDate(new Date(Date.parse(iso + "T00:00:00Z") + n * DAY));
const GDELT_MAX_AGE_DAYS = 85;

const htmlToLines = (html: string) => html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<\/?(p|div|br|tr|td|h[1-6]|li|table|center)\b[^>]*>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;|&#x2019;/gi, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&#x201[cd];/gi, '"').replace(/&#8211;|&#8212;|&ndash;|&mdash;|&#x201[34];/gi, "-").replace(/&#\d+;|&\w+;/g, " ")
  .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

const BOILER = /(furnished (and|but) (shall|will) not|incorporated by reference|cover page interactive|inline xbrl|general instruction|securities exchange act|check the appropriate box|emerging growth company|pursuant to the requirements|signature|commission file number|i\.r\.s\. employer|exhibit (no|number)|^item \d)/i;

/** Phrase d'annonce dans le 8-K lui-même (« … issued a press release announcing … »). */
export function summarize8K(html: string, _items: string[]): string | null {
  const text = htmlToLines(html).join(" ");
  const sentences = text.split(/(?<=[.;])\s+(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.length >= 40 && x.length <= 600 && !BOILER.test(x));
  const best = sentences.find((x) => /press release[^.]{0,250}(announc|report|regarding|relating|discuss)/i.test(x))
    ?? sentences.find((x) => /\b(announc\w*|entered into|appointed|resign\w*|complet\w* the|approv\w*|elected|declared|agreed to|acquir\w*|retire\w*)\b/i.test(x));
  if (!best) return null;
  // Retire un reste d'intitulé de rubrique en tête (« …Compensatory Arrangements of Certain Officers (d) Effective… »)
  const clean = best.replace(/^.*?(Certain Officers|Financial Condition|Material Definitive Agreement|Regulation FD Disclosure|Other Events|Assets|Bylaws|Fiscal Year)\.?\s*/i, "").replace(/^\([a-z]\)\s*/i, "").trim() || best;
  return clean.length > 420 ? clean.slice(0, 417) + "…" : clean;
}

/** Nom du fichier de la pièce EX-99.1 (communiqué de presse) d'après l'index de la déclaration. */
export function exhibit99(indexHtml: string): string | null {
  for (const row of indexHtml.split(/<tr/i)) {
    if (!/>\s*EX-99(\.0?1)?\s*</i.test(row)) continue;
    const m = /href="[^"]*\/([^"/]+\.html?)"/i.exec(row);
    if (m) return m[1];
  }
  return null;
}

/** Titre du communiqué de presse joint (pièce 99.1) : la nouvelle elle-même. */
export function pressReleaseHeadline(html: string): string | null {
  const lines = htmlToLines(html).filter((l) => l.length >= 25 && l.length <= 320);
  const skip = /^(exhibit|ex-?99|for immediate release|news release|press release|contacts?\b|media( relations)?\b|investors?( relations)?\b|source:|page \d|\(|forward-looking|safe harbor|about )/i;
  const dateOnly = /^[A-Z][a-z]+\.? \d{1,2}, \d{4}$/;
  const cands = lines.slice(0, 40).filter((l) => !skip.test(l) && !dateOnly.test(l) && !/@|www\.|\(\d{3}\)|\d{3}-\d{3}-\d{4}/.test(l) && !BOILER.test(l));
  const verb = /\b(reports?|announces?|posts?|raises?|declares?|appoints?|names?|completes?|enters?|delivers?|achieves?|agrees?|expands?|launches?|record|results|to acquire|acquires?|provides?|updates?|signs?|closes?|prices?|elects?|reaffirms?|increases?|lowers?|cuts?)\b/i;
  const pick = cands.find((l) => verb.test(l) && !/^[A-Z][\w.,&' ]+ (Inc|Corp|Corporation|Company|Ltd)\.?$/.test(l)) ?? null;
  if (!pick) return null;
  // Titres en capitales -> casse de phrase lisible
  const clean = pick === pick.toUpperCase() ? pick.charAt(0) + pick.slice(1).toLowerCase() : pick;
  return clean.length > 300 ? clean.slice(0, 297) + "…" : clean;
}

interface Win { ticker: string; debut: string; fin: string }

/** Fenêtres à couvrir par action, à partir des opérations (regroupées si elles se chevauchent). */
function windows(db: Db, before: number, after: number, newest = true): Win[] {
  const ops = db.all<{ ticker: string; ref: string; trimestre: string | null }>(sql`
    SELECT o.ticker, COALESCE(o.date_operation, o.date_publication) AS ref, r.trimestre
    FROM operations o LEFT JOIN raw_13f r ON r.cle_unique = o.cle_unique
    ORDER BY o.date_publication ${newest ? sql`DESC` : sql`ASC`}`);
  const byT = new Map<string, Win[]>();
  for (const o of ops) {
    let debut = shift(o.ref, -before), fin = shift(o.ref, after);
    if (o.trimestre) { const q = /^T([1-4]) (\d{4})$/.exec(o.trimestre); if (q) debut = shift(`${q[2]}-${["01-01", "04-01", "07-01", "10-01"][+q[1] - 1]}`, -before); }
    const list = byT.get(o.ticker) ?? [];
    const hit = list.find((w) => debut <= w.fin && fin >= w.debut);
    if (hit) { hit.debut = debut < hit.debut ? debut : hit.debut; hit.fin = fin > hit.fin ? fin : hit.fin; }
    else list.push({ ticker: o.ticker, debut, fin });
    byT.set(o.ticker, list);
  }
  return [...byT.values()].flat();
}

const fetched = (db: Db, w: Win, kind: string) =>
  db.select().from(s.newsFetch).where(and(eq(s.newsFetch.ticker, w.ticker), eq(s.newsFetch.kind, kind), sql`${s.newsFetch.debut} <= ${w.debut}`, sql`${s.newsFetch.fin} >= ${w.fin}`, sql`${s.newsFetch.statut} IN ('ok','hors-fenetre')`)).get();
const markFetched = (db: Db, w: Win, kind: string, statut: string, nb: number, erreur?: string) =>
  db.insert(s.newsFetch).values({ ...w, kind, statut, nb, appel: new Date().toISOString(), erreur: erreur ?? null })
    .onConflictDoUpdate({ target: [s.newsFetch.ticker, s.newsFetch.kind, s.newsFetch.debut, s.newsFetch.fin], set: { statut, nb, appel: new Date().toISOString(), erreur: erreur ?? null } }).run();

/** Annonces officielles (8-K) d'une fenêtre. */
async function collect8K(db: Db, w: Win, cik: string): Promise<number> {
  const hits = await eftsSearch({ forms: "8-K", ciks: cik, start: w.debut, end: [w.fin, isoDate(new Date())].sort()[0], max: 200 });
  let n = 0;
  for (const h of hits.filter((x) => x.form.startsWith("8-K"))) {
    const majors = h.items.filter((x) => ITEMS_8K_MAJEURS.has(x));
    if (!majors.length) continue;
    const url = archiveUrl(cik, h.adsh, h.file);
    let resume: string | null = null;
    // 1) titre du communiqué joint (pièce 99.x), 2) sinon phrase d'annonce du 8-K
    try {
      const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${h.adsh.replace(/-/g, "")}/`;
      const ex = exhibit99(await getArchive(`${dir}${h.adsh}-index.html`));
      if (ex) resume = pressReleaseHeadline(await getArchive(dir + ex));
    } catch { /* pas de pièce jointe lisible */ }
    if (!resume) { try { resume = summarize8K(await getArchive(url), majors); } catch { /* document illisible : on garde les rubriques */ } }
    const c = classify8K(majors, resume ?? "");
    n += db.insert(s.newsItems).values({
      ticker: w.ticker, date: h.fileDate, kind: "officiel", titre: majors.join(","), resume, source: "SEC EDGAR", url,
      items: h.items.join(","), themes: c.themes.join(","), ton: c.ton, cleUnique: `8K|${h.adsh}|${w.ticker}`,
    }).onConflictDoNothing().run().changes;
  }
  return n;
}

let lastGdelt = 0;
/** Articles de presse GDELT d'une fenêtre (requête sur le nom court de la société et son symbole). */
async function collectPresse(db: Db, w: Win, nom: string): Promise<number> {
  const name = shortName(nom);
  const q = name.split(" ").length >= 2 || name.length >= 6
    ? `("${name}" OR "${w.ticker} stock" OR "${w.ticker} shares") sourcelang:english`
    : `("${w.ticker} stock" OR "${w.ticker} shares" OR "${name} stock") sourcelang:english`;
  const fmt = (d: string, end: boolean) => d.replace(/-/g, "") + (end ? "235959" : "000000");
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=75&sort=hybridrel&startdatetime=${fmt(w.debut, false)}&enddatetime=${fmt([w.fin, isoDate(new Date())].sort()[0], true)}`;
  let body = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastGdelt + 6000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGdelt = Date.now();
    try { body = await getText(url, { userAgent: TOOL_UA, cacheTtl: 0, timeoutMs: 45_000 }); break; }
    catch (e) { if (e instanceof HttpError && e.status === 429) { await new Promise((r) => setTimeout(r, 8000)); continue; } throw e; }
  }
  if (!body) throw new Error("GDELT : quota dépassé (1 requête / 5 s), nouvel essai au prochain passage");
  const t = body.trim();
  if (!t.startsWith("{")) throw new Error(`GDELT : réponse inattendue (${t.slice(0, 80)})`);
  const articles = (JSON.parse(t).articles ?? []) as { url: string; title: string; seendate: string; domain: string; language?: string }[];
  let n = 0;
  for (const a of articles) {
    const c = classify(a.title);
    const date = `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}`;
    n += db.insert(s.newsItems).values({
      ticker: w.ticker, date, heure: `${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}`, kind: "presse", titre: a.title.replace(/\s+([,.:;?!%)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+'\s+/g, "'").trim(),
      source: a.domain, url: a.url, themes: c.themes.join(","), ton: c.ton, cleUnique: `GDELT|${w.ticker}|${a.url}`,
    }).onConflictDoNothing().run().changes;
  }
  return n;
}

export const collectNews: Collector = async (db) => {
  const maxOfficial = Number(process.env.NEWS_MAX_8K || 120), maxPresse = Number(process.env.NEWS_MAX_GDELT || 40);
  const tickers = new Map(db.select().from(s.tickers).all().map((t) => [t.ticker, t]));
  // NEWS_TICKERS=AMD,TSLA : ne traiter que ces actions (utile pour compléter une fiche à la main)
  const only = new Set((process.env.NEWS_TICKERS ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));
  const keep = (w: Win) => !only.size || only.has(w.ticker);
  let lues = 0, nouvelles = 0, nOff = 0, nPr = 0, sansCik = 0, horsFenetre = 0;
  const details: string[] = [], erreurs: string[] = [];

  // 1. Annonces officielles : 60 jours avant à 5 jours après chaque opération
  for (const w of windows(db, 60, 5).filter(keep)) {
    if (nOff >= maxOfficial) break;
    if (fetched(db, w, "officiel")) continue;
    const cik = tickers.get(w.ticker)?.cik;
    if (!cik) { sansCik++; markFetched(db, w, "officiel", "hors-fenetre", 0, "CIK inconnu"); continue; }
    nOff++;
    try { const n = await collect8K(db, w, cik); nouvelles += n; lues++; markFetched(db, w, "officiel", "ok", n); }
    catch (e) { erreurs.push(`8-K ${w.ticker} : ${(e as Error).message}`); markFetched(db, w, "officiel", "erreur", 0, (e as Error).message); }
  }

  // 2. Presse : 14 jours avant à 3 jours après, seulement dans les 3 derniers mois (limite de GDELT)
  const limit = daysAgo(GDELT_MAX_AGE_DAYS);
  for (const w of windows(db, 14, 3).filter(keep)) {
    if (nPr >= maxPresse) break;
    if (fetched(db, w, "presse")) continue;
    if (w.fin < limit) { horsFenetre++; markFetched(db, w, "presse", "hors-fenetre", 0, "archive GDELT limitée aux 3 derniers mois"); continue; }
    const nom = tickers.get(w.ticker)?.nom ?? w.ticker;
    nPr++;
    try { const n = await collectPresse(db, w, nom); nouvelles += n; lues++; markFetched(db, w, "presse", "ok", n); }
    catch (e) {
      erreurs.push(`presse ${w.ticker} : ${(e as Error).message}`);
      markFetched(db, w, "presse", "erreur", 0, (e as Error).message);
      if (/quota/.test((e as Error).message)) break;
    }
  }
  details.push(`${nOff} fenêtre(s) 8-K et ${nPr} fenêtre(s) de presse interrogées ; ${sansCik} action(s) sans CIK ; ${horsFenetre} fenêtre(s) trop anciennes pour la presse`);
  if (erreurs.length) details.push(...erreurs.slice(0, 10));
  if (lues === 0 && erreurs.length) throw new Error(erreurs[0]);
  return { lues, nouvelles, details, donneesAu: db.get<{ d: string }>(sql`SELECT MAX(date) d FROM news_items`)?.d ?? null };
};
