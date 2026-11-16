import { type Db, type Holding13F, type ThirteenFJson, adapt13F, diff13F, insertIgnore, insertOperations, loadTickerNames, parseInfoTable, parseInsidersetActivity, parseInsidersetInvestor, quarterEnd, schema as s, thirteenFKey } from "@tracker/core";
import { and, eq, isNull, or } from "drizzle-orm";
import { getJson, getText } from "../http";
import { TOOL_UA, secUserAgent } from "../env";
import { CIK, archiveUrl, eftsSearch, getArchive, type EftsHit } from "../sec";
import { type Collector, isoDate } from "./types";

/** Fonds suivis. `nom` sert à retrouver le CIK sur EDGAR (recherche plein texte sur les 13F-HR). */
export const FUNDS = [
  { slug: "warren-buffett-berkshire-hathaway", investisseur: "Warren Buffett", fonds: "Berkshire Hathaway", nom: /^berkshire hathaway inc/i, q: "Berkshire Hathaway", cik: CIK.BERKSHIRE },
  { slug: "bill-gates-bill-and-melinda-gates-foundation-trust", investisseur: "Bill Gates", fonds: "Gates Foundation Trust", nom: /gates foundation trust/i, q: "Gates Foundation Trust" },
  { slug: "david-tepper-appaloosa", investisseur: "David Tepper", fonds: "Appaloosa", nom: /^appaloosa/i, q: "Appaloosa" },
  { slug: "stanley-druckenmiller-duquesne-family-office", investisseur: "Stanley Druckenmiller", fonds: "Duquesne Family Office", nom: /duquesne family office/i, q: "Duquesne Family Office" },
  { slug: "bill-ackman-pershing-square-capital-management", investisseur: "Bill Ackman", fonds: "Pershing Square", nom: /pershing square capital management/i, q: "Pershing Square Capital Management" },
  { slug: "carl-icahn-icahn", investisseur: "Carl Icahn", fonds: "Icahn Capital", nom: /^icahn carl/i, q: "Icahn Carl" },
  { slug: "thiel-macro-llc", investisseur: "Peter Thiel", fonds: "Thiel Macro", nom: /^thiel macro/i, q: "Thiel Macro" },
] as const;
type Fund = (typeof FUNDS)[number];

const IS = "https://www.insiderset.com";
const toQuarterSlug = (t: string) => t.replace(/^T(\d) (\d{4})$/, "q$1-$2"); // "T2 2026" -> "q2-2026"

/** CIK d'un fonds : connu, déjà en base, ou trouvé par recherche plein texte (puis mémorisé). */
async function resolveCik(db: Db, f: Fund): Promise<string> {
  if ("cik" in f && f.cik) return f.cik;
  const known = db.select().from(s.funds).where(eq(s.funds.slug, f.slug)).get()?.cik;
  if (known) return known;
  const hits = await eftsSearch({ q: `"${f.q}"`, forms: "13F-HR", start: isoDate(new Date(Date.now() - 400 * 86400_000)), end: isoDate(new Date()), max: 300 });
  for (const h of hits) for (const n of h.displayNames) {
    const m = /^(.*?)\s+(?:\(.*?\)\s+)?\(CIK (\d{10})\)$/.exec(n);
    if (m && f.nom.test(m[1].trim())) {
      db.update(s.funds).set({ cik: m[2] }).where(eq(s.funds.slug, f.slug)).run();
      return m[2];
    }
  }
  throw new Error(`CIK introuvable sur EDGAR pour ${f.fonds}`);
}

/** Fichier « information table » d'une déclaration 13F-HR (le XML qui n'est pas primary_doc.xml). */
async function infoTable(cik: string, hit: EftsHit): Promise<{ url: string; holdings: Holding13F[] }> {
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${hit.adsh.replace(/-/g, "")}/`;
  const idx = await getJson<{ directory: { item: { name: string }[] } }>(dir + "index.json", { userAgent: secUserAgent(), cacheTtl: Infinity });
  const file = idx.directory.item.map((i) => i.name).find((n) => n.endsWith(".xml") && n !== "primary_doc.xml");
  if (!file) throw new Error(`table d'information absente de ${hit.adsh}`);
  const url = archiveUrl(cik, hit.adsh, file);
  return { url, holdings: parseInfoTable(await getArchive(url)) };
}

/** 13F-HR (hors amendements) d'un fonds, indexés par date de fin de trimestre. */
export async function filingsByPeriod(cik: string) {
  const hits = await eftsSearch({ forms: "13F-HR", ciks: cik, start: isoDate(new Date(Date.now() - 800 * 86400_000)), end: isoDate(new Date()), max: 100 });
  const m = new Map<string, EftsHit>();
  for (const h of hits.filter((x) => x.form === "13F-HR" && x.periodEnding).sort((a, b) => a.fileDate.localeCompare(b.fileDate))) m.set(h.periodEnding!, h);
  return m;
}

/** Fin du trimestre précédent : 2026-06-30 -> 2026-03-31, 2026-03-31 -> 2025-12-31. */
export const prevQuarterEnd = (end: string) => {
  const [y, mo] = end.split("-").map(Number);
  return { 3: `${y - 1}-12-31`, 6: `${y}-03-31`, 9: `${y}-06-30`, 12: `${y}-09-30` }[mo]!;
};

/**
 * Vérifie les mouvements d'un trimestre sur EDGAR : différence entre les tables d'information de ce trimestre
 * et du précédent, rapprochée ligne à ligne par nombre d'actions. Renvoie les détails à journaliser.
 */
async function verifyQuarter(db: Db, f: Fund, cik: string, trimestre: string, byPeriod: Map<string, EftsHit>): Promise<string[]> {
  const end = quarterEnd(trimestre)!;
  const cur = byPeriod.get(end), prev = byPeriod.get(prevQuarterEnd(end));
  if (!cur) return [`${f.fonds} ${trimestre} : 13F-HR introuvable sur EDGAR`];
  if (!prev) return [`${f.fonds} ${trimestre} : 13F-HR du trimestre précédent introuvable, pas de différence calculable`];
  const [a, b] = [await infoTable(cik, prev), await infoTable(cik, cur)];
  const moves = diff13F(a.holdings, b.holdings);
  // Poids et rang de chaque ligne dans le portefeuille déclaré (valeur de la ligne / valeur totale)
  const total = b.holdings.reduce((x, h) => x + h.value, 0);
  const ranked = [...b.holdings].sort((x, y) => y.value - x.value);
  const weight = (cusip: string) => {
    const i = ranked.findIndex((h) => h.cusip === cusip);
    return i < 0 || !total ? { poidsPct: 0, rang: null } : { poidsPct: Math.round((ranked[i].value / total) * 10000) / 100, rang: i + 1 };
  };
  const rows = db.select().from(s.raw13f).where(and(eq(s.raw13f.fonds, f.fonds), eq(s.raw13f.trimestre, trimestre))).all();
  const used = new Set<string>();
  let ok = 0;
  const ecarts: string[] = [];
  for (const r of rows) {
    const m = moves.find((x) => !used.has(x.cusip) && x.variation === r.variationActions && x.operation === r.operation);
    if (!m) {
      if (!r.cusip) ecarts.push(`${r.ticker} ${r.operation} ${r.variationActions}`);
      else if (r.poidsPct == null) db.update(s.raw13f).set(weight(r.cusip)).where(eq(s.raw13f.id, r.id)).run();
      continue;
    }
    used.add(m.cusip);
    ok++;
    db.update(s.raw13f).set({ verifieEdgar: true, cusip: m.cusip, sourceUrl: b.url, ...weight(m.cusip) }).where(eq(s.raw13f.id, r.id)).run();
    db.update(s.operations).set({ verifieEdgar: true, sourceUrl: b.url }).where(eq(s.operations.cleUnique, r.cleUnique)).run();
    db.update(s.tickers).set({ cusip: m.cusip }).where(eq(s.tickers.ticker, r.ticker)).run();
  }
  const absents = moves.filter((m) => !used.has(m.cusip));
  // Mouvements officiels absents d'insiderset : ajoutés si le CUSIP identifie une société connue.
  const byCusip = new Map(db.select().from(s.tickers).all().filter((t) => t.cusip).map((t) => [t.cusip!.toUpperCase(), t]));
  const added: string[] = [];
  const unknown: typeof absents = [];
  const extra: ThirteenFJson[] = [];
  const weights = new Map<string, { poidsPct: number; rang: number | null }>();
  for (const m of absents) {
    const t = byCusip.get(m.cusip);
    if (!t) { unknown.push(m); continue; }
    extra.push({ investisseur: f.investisseur, fonds: f.fonds, trimestre, depose_le: cur.fileDate, ticker: t.ticker, societe: t.nom, cusip: m.cusip,
      operation: m.operation, variation_actions: m.variation, variation_pct: m.operation === "Sortie totale" ? -100 : m.variation_pct, verifie_edgar: true, source_url: b.url });
    weights.set(m.cusip, weight(m.cusip));
    added.push(`${t.ticker} ${m.operation} ${m.variation}`);
  }
  if (extra.length) {
    const r = adapt13F(extra, loadTickerNames(db));
    insertIgnore(db, s.raw13f, r.raw.map((x) => ({ ...x, ...(x.cusip ? weights.get(x.cusip) : {}) })));
    insertOperations(db, r.operations);
  }
  return [
    `${f.fonds} ${trimestre} : ${ok}/${rows.length} mouvements confirmés sur EDGAR (${cur.adsh})`,
    ...(ecarts.length ? [`  non confirmés : ${ecarts.slice(0, 8).join(" ; ")}${ecarts.length > 8 ? " …" : ""}`] : []),
    ...(added.length ? [`  ${added.length} mouvement(s) absents d'insiderset ajoutés depuis EDGAR : ${added.join(" ; ")}`] : []),
    ...(unknown.length ? [`  ${unknown.length} mouvement(s) EDGAR non repris (CUSIP sans symbole connu) : ${unknown.slice(0, 5).map((x) => `${x.nameOfIssuer} [${x.cusip}] ${x.variation}`).join(", ")}`] : []),
  ];
}

/** Super-investisseurs : dernier 13F de chaque fonds (insiderset), puis vérification des quantités sur EDGAR. */
export const collect13F: Collector = async (db) => {
  const names = loadTickerNames(db);
  let lues = 0, nouvelles = 0;
  const details: string[] = [], evenements: string[] = [], erreurs: string[] = [];
  for (const f of FUNDS) {
    db.insert(s.funds).values({ slug: f.slug, investisseur: f.investisseur, fonds: f.fonds }).onConflictDoNothing().run();
    try {
      const inv = parseInsidersetInvestor(await getText(`${IS}/investor/${f.slug}`, { userAgent: TOOL_UA, cacheTtl: 3600 }));
      const known = db.select().from(s.raw13f).where(and(eq(s.raw13f.fonds, f.fonds), eq(s.raw13f.trimestre, inv.trimestre))).all().length;
      const moves = parseInsidersetActivity(await getText(`${IS}/investor/${f.slug}/activity/${toQuarterSlug(inv.trimestre)}`, { userAgent: TOOL_UA, cacheTtl: 3600 }));
      const json: ThirteenFJson[] = moves.filter((m) => m.trimestre === inv.trimestre).map((m) => ({
        investisseur: f.investisseur, fonds: f.fonds, trimestre: m.trimestre, depose_le: inv.depose_le,
        ticker: m.ticker, societe: names.get(m.ticker) ?? m.societe, operation: m.operation,
        variation_actions: m.variation_actions, variation_pct: m.variation_pct, verifie_edgar: false,
      }));
      lues += json.length;
      const r = adapt13F(json, names);
      insertIgnore(db, s.raw13f, r.raw);
      const n = insertOperations(db, r.operations);
      nouvelles += n;
      if (!known && json.length) evenements.push(`Nouveau 13F ${f.investisseur} (${inv.trimestre}) depose le ${inv.depose_le}`);
      details.push(`${f.investisseur} : ${inv.trimestre} déposé le ${inv.depose_le}, ${json.length} mouvements, ${n} nouveaux`);
      db.update(s.funds).set({ dernierTrimestre: inv.trimestre, dernierDepot: inv.depose_le }).where(eq(s.funds.slug, f.slug)).run();

      // Vérification EDGAR (et détection d'un 13F déposé avant la mise à jour d'insiderset)
      const cik = await resolveCik(db, f);
      const byPeriod = await filingsByPeriod(cik);
      const lastEnd = [...byPeriod.keys()].sort().at(-1);
      if (lastEnd && lastEnd > quarterEnd(inv.trimestre)!) {
        const h = byPeriod.get(lastEnd)!;
        evenements.push(`Nouveau 13F ${f.investisseur} depose sur EDGAR le ${h.fileDate} (fin de trimestre ${lastEnd})`);
        details.push(`  ${f.fonds} : 13F du ${lastEnd} déjà sur EDGAR (${h.adsh}), pas encore sur insiderset`);
      }
      // À vérifier : toute ligne non rapprochée par nous d'une ligne EDGAR (pas de CUSIP), même marquée vérifiée par le kit.
      const unverified = db.select().from(s.raw13f).where(and(eq(s.raw13f.fonds, f.fonds), eq(s.raw13f.trimestre, inv.trimestre), or(eq(s.raw13f.verifieEdgar, false), isNull(s.raw13f.cusip), isNull(s.raw13f.poidsPct)))).all();
      if (unverified.length) details.push(...(await verifyQuarter(db, f, cik, inv.trimestre, byPeriod)).map((d) => "  " + d));
    } catch (e) {
      erreurs.push(`${f.fonds} : ${(e as Error).message}`);
    }
  }
  if (erreurs.length === FUNDS.length) throw new Error(erreurs.join(" | "));
  return { lues, nouvelles, details: [...details, ...erreurs.map((e) => `ERREUR ${e}`)], evenements,
    donneesAu: db.select({ d: s.raw13f.deposeLe }).from(s.raw13f).all().map((x) => x.d).sort().at(-1) ?? null };
};
export { thirteenFKey };
