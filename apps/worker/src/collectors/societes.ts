import { type Db, schema as s } from "@tracker/core";
import { sql } from "drizzle-orm";
import { HttpError, getJson } from "../http";
import { TOOL_UA } from "../env";
import { type Collector, isoDate } from "./types";
import { type FinnhubNews, universe } from "./calendrier";

/**
 * Sociétés suivies (opérations des investisseurs depuis 6 mois, mon portefeuille, ma liste) :
 *  - profil : identité, secteur, capitalisation (Finnhub /stock/profile2), rafraîchi tous les 30 jours ;
 *  - activité en français : introduction de l'article Wikipédia, retrouvé par le symbole boursier dans Wikidata
 *    (cotation au NYSE ou au Nasdaq en cours) ; à défaut, article anglais ;
 *  - dernières nouvelles (Finnhub /company-news, 7 jours) : mes actions à chaque passage, les autres toutes les 12 heures.
 */
const FH = "https://finnhub.io/api/v1";
const PROFILS_MAX = Number(process.env.PROFILS_MAX_PER_RUN || 400);
const NOUVELLES_MAX = Number(process.env.NOUVELLES_MAX_PER_RUN || 250);
const addDays = (iso: string, n: number) => isoDate(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000));

interface Profile2 { name?: string; finnhubIndustry?: string; country?: string; exchange?: string; ipo?: string; marketCapitalization?: number; weburl?: string; logo?: string }
type Sparql = { results: { bindings: Record<string, { value: string }>[] } };

/** Articles Wikipédia (fr, en) par symbole, via Wikidata : cotation NYSE (Q13677) ou Nasdaq (Q82059) sans date de fin. */
export async function wikiArticles(tickers: string[]): Promise<Map<string, { item: string; fr?: string; en?: string; courte?: string; nom?: string }>> {
  const out = new Map<string, { item: string; fr?: string; en?: string; courte?: string; nom?: string }>();
  for (let i = 0; i < tickers.length; i += 80) {
    const values = tickers.slice(i, i + 80).map((t) => JSON.stringify(t)).join(" ");
    const q = `SELECT ?t ?item ?fr ?en ?courte ?nom WHERE { VALUES ?t { ${values} } VALUES ?bourse { wd:Q13677 wd:Q82059 }
      ?item p:P414 ?st . ?st ps:P414 ?bourse ; pq:P249 ?t . FILTER NOT EXISTS { ?st pq:P582 ?fin }
      OPTIONAL { ?fr schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> }
      OPTIONAL { ?en schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      OPTIONAL { ?item schema:description ?courte FILTER(LANG(?courte) = "fr") }
      OPTIONAL { ?item rdfs:label ?nom FILTER(LANG(?nom) = "en") } }`;
    const r = await getJson<Sparql>(`https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}`, { userAgent: TOOL_UA, cacheTtl: 0, accept: "application/sparql-results+json" });
    for (const b of r.results.bindings) {
      const t = b.t.value, prev = out.get(t);
      // Plusieurs entités pour un symbole : on garde celle qui a un article français
      if (prev?.fr && !b.fr) continue;
      out.set(t, { item: b.item.value.split("/").pop()!, fr: b.fr?.value, en: b.en?.value, courte: b.courte?.value, nom: b.nom?.value });
    }
  }
  return out;
}

/** Introduction d'articles Wikipédia, par lots de 20 (API « extracts » de MediaWiki). */
export async function wikiExtracts(lang: "fr" | "en", urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const titre = (u: string) => decodeURIComponent(u.split("/wiki/")[1] ?? "").replace(/_/g, " ");
  for (let i = 0; i < urls.length; i += 20) {
    const lot = urls.slice(i, i + 20);
    const p = new URLSearchParams({ action: "query", prop: "extracts", exintro: "1", explaintext: "1", exlimit: "20", redirects: "1", format: "json", formatversion: "2", titles: lot.map(titre).join("|") });
    type R = { query?: { pages?: { title: string; extract?: string }[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } };
    let r: R;
    try { r = await getJson<R>(`https://${lang}.wikipedia.org/w/api.php?${p}`, { userAgent: TOOL_UA, cacheTtl: 0 }); }
    catch (e) { if (e instanceof HttpError && e.status === 429) break; throw e; } // limite Wikimedia : on garde ce qui est acquis
    const alias = new Map<string, string>();
    for (const x of [...(r.query?.normalized ?? []), ...(r.query?.redirects ?? [])]) alias.set(x.from, x.to);
    const pages = new Map((r.query?.pages ?? []).map((pg) => [pg.title, pg.extract ?? ""]));
    for (const u of lot) {
      let t = titre(u);
      for (let k = 0; k < 3 && alias.has(t); k++) t = alias.get(t)!;
      const txt = resumer(pages.get(t) ?? "");
      if (txt) out.set(u, txt);
    }
  }
  return out;
}

const VIDES = new Set(["inc", "corp", "corporation", "co", "company", "the", "group", "holdings", "holding", "ltd", "plc", "sa", "nv", "llc", "lp", "trust", "and", "de", "international", "class", "shares"]);
const mots = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((m) => m.length >= 2 && !VIDES.has(m));
/**
 * L'article décrit-il bien la société ? (un symbole peut avoir appartenu à une autre entreprise : ACT = Actavis puis Enact)
 * Un mot significatif du nom (ou son sigle : ADP = Automatic Data Processing) doit figurer dans le titre ou le début de l'article.
 */
export function memeSociete(nom: string | null | undefined, titre: string, extrait: string): boolean {
  if (!nom) return true;
  const n = mots(nom);
  if (!n.length) return true;
  const cible = new Set(mots(`${titre} ${extrait.slice(0, 300)}`));
  const sigle = n.map((m) => m[0]).join("");
  return n.some((m) => m.length >= 3 && cible.has(m)) || (sigle.length >= 2 && cible.has(sigle));
}

/** Deux premiers paragraphes, 900 caractères au plus, coupés en fin de phrase. */
export function resumer(extract: string, max = 900): string {
  const paras = extract.split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 40);
  let t = paras.slice(0, 2).join("\n");
  if (t.length > max) {
    const cut = t.slice(0, max);
    const fin = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
    t = fin > 200 ? cut.slice(0, fin + 1) : cut.trimEnd() + "…";
  }
  return t;
}

export const collectSocietes: Collector = async (db: Db) => {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) throw new Error("FINNHUB_API_KEY manquant (clé gratuite sur finnhub.io)");
  const fh = { userAgent: TOOL_UA, cacheTtl: 0, headers: { "X-Finnhub-Token": key } };
  const today = isoDate(new Date()), now = new Date().toISOString();
  const { tous, miens } = universe(db, today);
  const existants = new Map(db.select().from(s.profils).all().map((p) => [p.ticker, p]));
  const details: string[] = [];
  let lues = 0, nouvelles = 0, quota = false;
  const upsert = (v: typeof s.profils.$inferInsert) => db.insert(s.profils).values(v).onConflictDoUpdate({ target: s.profils.ticker, set: v }).run();

  // 1. Profils manquants ou de plus de 30 jours (mes actions d'abord)
  const ordre = [...miens, ...[...tous].filter((t) => !miens.includes(t))];
  const todo = ordre.filter((t) => { const p = existants.get(t); return !p?.profilLe || p.profilLe < addDays(today, -30); }).slice(0, PROFILS_MAX);
  const faits: string[] = [];
  for (const t of todo) {
    try {
      const p = await getJson<Profile2>(`${FH}/stock/profile2?symbol=${encodeURIComponent(t)}`, fh);
      lues++;
      const prev = existants.get(t);
      upsert({ ticker: t, nom: p.name ?? prev?.nom ?? null, secteur: p.finnhubIndustry || null, pays: p.country || null, bourse: p.exchange || null, ipo: p.ipo || null,
        capitalisation: p.marketCapitalization ?? null, site: p.weburl || null, logo: p.logo || null, description: prev?.description ?? null, langue: prev?.langue ?? null,
        wikipedia: prev?.wikipedia ?? null, wikidata: prev?.wikidata ?? null, profilLe: now, wikiLe: prev?.wikiLe ?? null, nouvellesLe: prev?.nouvellesLe ?? null });
      faits.push(t);
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) { quota = true; details.push("Quota Finnhub atteint : profils repris au prochain passage"); break; }
      details.push(`${t} (profil) : ${(e as Error).message}`);
    }
  }
  // 2. Activité en français (Wikipédia) : profils sans description, recherche refaite au plus une fois par semaine
  let descr = 0;
  const semaine = addDays(today, -7);
  const aDecrire = db.select().from(s.profils).all()
    .filter((p) => p.profilLe && tous.has(p.ticker) && (faits.includes(p.ticker) || ((!p.description || p.langue === "wd") && (!p.wikiLe || p.wikiLe < semaine || p.langue === "wd"))))
    .sort((a, b) => Number(miens.includes(b.ticker)) - Number(miens.includes(a.ticker))).slice(0, 200).map((p) => p.ticker);
  if (aDecrire.length) {
    try {
      const art = await wikiArticles(aDecrire);
      const fr = await wikiExtracts("fr", [...art.values()].flatMap((a) => (a.fr ? [a.fr] : [])));
      const enUrls = [...art.values()].filter((a) => a.en && !(a.fr && fr.has(a.fr))).map((a) => a.en!);
      const en = enUrls.length ? await wikiExtracts("en", enUrls).catch(() => new Map<string, string>()) : new Map<string, string>();
      const titre = (u?: string) => decodeURIComponent(u?.split("/wiki/")[1] ?? "").replace(/_/g, " ");
      for (const t of aDecrire) {
        const a = art.get(t);
        const nom = db.select({ n: s.profils.nom }).from(s.profils).where(sql`ticker = ${t}`).get()?.n;
        const ok = (u: string | undefined, txt: string | undefined) => (u && txt && memeSociete(nom, titre(u), txt) ? txt : undefined);
        const txtFr = a ? ok(a.fr, a.fr ? fr.get(a.fr) : undefined) : undefined, txtEn = a ? ok(a.en, a.en ? en.get(a.en) : undefined) : undefined;
        // Article trouvé mais texte pas encore lu (limite Wikimedia) : on réessaiera au prochain passage
        const enAttente = a && !txtFr && !txtEn && ((a.fr && !fr.has(a.fr)) || (a.en && !en.has(a.en) && !a.fr));
        // En attendant l'article : la définition courte de Wikidata (« entreprise américaine de jeux vidéo »), en français
        const courte = a?.courte && memeSociete(nom, a.nom ?? "", "") ? a.courte.charAt(0).toUpperCase() + a.courte.slice(1) + "." : null;
        if (enAttente) {
          if (courte) db.update(s.profils).set({ description: courte, langue: "wd", wikipedia: a!.fr ?? a!.en ?? null, wikidata: a!.item }).where(sql`ticker = ${t} AND (description IS NULL OR langue = 'wd')`).run();
          continue;
        }
        const [description, langue, wikipedia] = txtFr ? [txtFr, "fr", a!.fr!] : txtEn ? [txtEn, "en", a!.en!] : courte ? [courte, "wd", a!.fr ?? a!.en ?? null] : [null, null, null];
        db.update(s.profils).set({ description, langue, wikipedia, wikidata: description ? a!.item : null, wikiLe: now }).where(sql`ticker = ${t}`).run();
        if (description) descr++;
      }
    } catch (e) {
      details.push(`Wikipédia / Wikidata : ${(e as Error).message}`);
    }
  }
  const sans = db.select({ d: s.profils.description, p: s.profils.profilLe }).from(s.profils).all().filter((p) => p.p && !p.d).length;
  details.push(`${faits.length} profil(s) mis à jour ; ${descr} description(s) d'activité ajoutée(s) (Wikipédia), ${sans} société(s) encore sans description`);

  // 3. Dernières nouvelles : mes actions à chaque passage, les autres si plus vieilles que 12 heures
  if (!quota) {
    const vieux = new Date(Date.now() - 12 * 3600_000).toISOString();
    const prof = new Map(db.select({ t: s.profils.ticker, n: s.profils.nouvellesLe }).from(s.profils).all().map((r) => [r.t, r.n]));
    const file = [...miens, ...[...tous].filter((t) => !miens.includes(t) && (!prof.get(t) || prof.get(t)! < vieux)).sort((a, b) => (prof.get(a) ?? "").localeCompare(prof.get(b) ?? ""))];
    let nv = 0, n = 0;
    for (const t of file.slice(0, NOUVELLES_MAX)) {
      try {
        const items = await getJson<FinnhubNews[]>(`${FH}/company-news?symbol=${encodeURIComponent(t)}&from=${addDays(today, -7)}&to=${today}`, fh);
        lues += items.length; n++;
        for (const it of items.filter((x) => x.headline).sort((a, b) => b.datetime - a.datetime).slice(0, 8)) {
          const dt = new Date(it.datetime * 1000).toISOString();
          nv += db.insert(s.evenements).values({ cle: `fh:${it.id}`, date: dt.slice(0, 10), heure: dt.slice(11, 16), ticker: t, type: "nouvelle", titre: it.headline,
            source: it.source || "Finnhub", url: it.url || null, collecteLe: now, details: JSON.stringify({ resume: it.summary?.slice(0, 600) ?? "" }) }).onConflictDoNothing().run().changes;
        }
        db.insert(s.profils).values({ ticker: t, nouvellesLe: now }).onConflictDoUpdate({ target: s.profils.ticker, set: { nouvellesLe: now } }).run();
      } catch (e) {
        if (e instanceof HttpError && e.status === 429) { details.push("Quota Finnhub atteint : nouvelles reprises au prochain passage"); break; }
        details.push(`${t} (nouvelles) : ${(e as Error).message}`);
      }
    }
    db.run(sql`DELETE FROM evenements WHERE type = 'nouvelle' AND date < ${addDays(today, -60)}`);
    details.push(`${nv} nouvelle(s) sur ${n} société(s)`);
    nouvelles += nv;
  }
  return { lues, nouvelles: nouvelles + faits.length, details, donneesAu: today };
};
