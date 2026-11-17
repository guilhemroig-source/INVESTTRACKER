import { type Db, importsEnAttente, processImports, refreshAnalyses, schema as s } from "@tracker/core";
import { eq, sql } from "drizzle-orm";
import { HttpError, getJson } from "../http";
import { TOOL_UA } from "../env";
import { type Collector, isoDate } from "./types";

/**
 * Cours journaliers via l'API Tiingo (clé gratuite : TIINGO_API_KEY).
 * Offre gratuite ≈ 50 requêtes/heure et 1 000/jour : chaque passage traite au plus TIINGO_MAX_PER_RUN actions
 * (45 par défaut), les opérations les plus récentes d'abord ; une action déjà couverte n'est complétée que si besoin.
 */
const HISTORY_DAYS = 420; // ~ 290 séances avant l'opération : assez pour la MM200 et 6 mois de supports
const AFTER_DAYS = 100; // pour mesurer l'évolution 5, 20 et 60 séances après

const tiingoSymbol = (t: string) => t.replace(/\./g, "-");
const addDays = (iso: string, n: number) => isoDate(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000));

interface TiingoBar { date: string; adjOpen: number; adjHigh: number; adjLow: number; adjClose: number; adjVolume: number; close: number }

/**
 * Cours du jour des lignes de « Mon portefeuille » (et des imports en attente) via Finnhub /quote :
 * indépendant du quota Tiingo, rafraîchi à chaque passage. Tiingo remplace ensuite la séance par ses cours ajustés.
 */
export async function coursDuJour(db: Db): Promise<string[]> {
  const fh = process.env.FINNHUB_API_KEY?.trim();
  if (!fh) return [];
  const actifs = db.select().from(s.actifsPerso).all();
  const perso = new Map(actifs.map((a) => [a.ticker, a]));
  const pf = db.all<{ t: string }>(sql`SELECT DISTINCT ticker t FROM portfolio_tx`).map((r) => r.t);
  const att = importsEnAttente(db).map((l) => l.ticker.trim().toUpperCase());
  const out: string[] = [];
  for (const t of [...new Set([...pf, ...att])]) {
    const a = perso.get(t);
    if (a && a.cotation !== "crypto") continue; // cours saisi : rien à télécharger
    // Crypto : paire Tiingo « btcusd » -> symbole Finnhub « BINANCE:BTCUSDT »
    const sym = a ? `BINANCE:${a.indice!.toUpperCase().replace(/USD$/, "")}USDT` : t.replace(/\./g, "-");
    try {
      const q = await getJson<{ c: number; h: number; l: number; o: number; t: number; pc: number }>(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}`,
        { userAgent: TOOL_UA, cacheTtl: 0, headers: { "X-Finnhub-Token": fh } });
      if (!(q.c > 0) || !q.t) continue;
      const date = isoDate(new Date(q.t * 1000));
      // Ne remplace pas une séance déjà fournie par Tiingo (cours ajustés)
      const deja = db.get<{ v: number }>(sql`SELECT volume v FROM prices WHERE ticker = ${t} AND date = ${date}`);
      if (deja && deja.v > 0) continue;
      const row = { ticker: t, date, open: q.o || q.c, high: q.h || q.c, low: q.l || q.c, close: q.c, volume: 0, closeBrut: q.c };
      db.insert(s.prices).values(row).onConflictDoUpdate({ target: [s.prices.ticker, s.prices.date], set: row }).run();
      // Clôture de la veille (séance précédente : on saute le week-end pour une action), si Tiingo ne l'a pas encore
      if (q.pc > 0) {
        const d = new Date(`${date}T12:00:00Z`);
        do d.setUTCDate(d.getUTCDate() - 1); while (!a && (d.getUTCDay() === 0 || d.getUTCDay() === 6));
        const veille = isoDate(d);
        if (!db.get(sql`SELECT 1 FROM prices WHERE ticker = ${t} AND date = ${veille}`))
          db.insert(s.prices).values({ ticker: t, date: veille, open: q.pc, high: q.pc, low: q.pc, close: q.pc, volume: 0, closeBrut: q.pc }).run();
      }
      out.push(`${t} ${q.c}`);
    } catch (e) {
      out.push(`${t} : ${(e as Error).message}`);
    }
  }
  return out;
}

export const collectPrix: Collector = async (db) => {
  const jour = await coursDuJour(db);
  const key = process.env.TIINGO_API_KEY?.trim();
  if (!key) {
    for (const r of processImports(db)) jour.push(`Import ${r.ticker} : ${r.statut} (${r.detail})`);
    if (jour.length) return { lues: jour.length, nouvelles: jour.length, details: ["Cours du jour (Finnhub) : " + jour.join(", "), "TIINGO_API_KEY manquant : pas d'historique"] };
    throw new Error("TIINGO_API_KEY manquant dans .env (clé gratuite sur tiingo.com)");
  }
  const budget = Number(process.env.TIINGO_MAX_PER_RUN || 45);
  const today = isoDate(new Date());

  // Besoin par action : de (plus ancienne opération − 420 j) à (plus récente + 100 j, au plus aujourd'hui)
  const needs = db.all<{ ticker: string; first: string; last: string; pub: string }>(sql`
    SELECT ticker,
      MIN(COALESCE(date_operation, date_publication)) AS first,
      MAX(COALESCE(date_operation, date_publication)) AS last,
      MAX(date_publication) AS pub
    FROM (
      SELECT ticker, date_operation, date_publication FROM operations
      UNION ALL SELECT ticker, date AS date_operation, date AS date_publication FROM portfolio_tx -- actions de « Mon portefeuille »
    ) GROUP BY ticker ORDER BY pub DESC`);
  // Indices de référence (S&P 500, Nasdaq 100) pour situer chaque action dans son marché
  const span = needs.reduce((a, n) => ({ first: n.first < a.first ? n.first : a.first, last: n.last > a.last ? n.last : a.last, pub: a.pub }), { first: "9999", last: "0000", pub: "9999" });
  // VT : ETF monde (Vanguard Total World), référence pour comparer « Mon portefeuille »
  if (needs.length) needs.unshift({ ticker: "SPY", ...span }, { ticker: "QQQ", ...span }, { ticker: "VT", ...span });
  // Actifs hors actions américaines (ETF européens, actions françaises, non coté, cryptos) : pas de cours Tiingo « actions » ;
  // les indices qui prolongent leurs cours saisis (ex. SPY) restent, eux, téléchargés.
  const actifs = db.select().from(s.actifsPerso).all();
  const perso = new Set(actifs.map((a) => a.ticker));
  for (const a of actifs) if (a.cotation === "manuel" && a.indice && !needs.some((n) => n.ticker === a.indice)) needs.push({ ticker: a.indice, ...span });
  for (let i = needs.length - 1; i >= 0; i--) if (perso.has(needs[i].ticker)) needs.splice(i, 1);
  // Lignes importées en attente de cours : en tête de file
  const today0 = isoDate(new Date());
  for (const l of importsEnAttente(db).filter((x) => (x.cotation ?? "marche") === "marche")) {
    const t = l.ticker.trim().toUpperCase();
    const i = needs.findIndex((n) => n.ticker === t);
    const n = i >= 0 ? needs.splice(i, 1)[0] : { ticker: t, first: today0, last: today0, pub: today0 };
    needs.unshift(n); // déjà connue (opérations d'investisseurs) ou non : en tête de file
  }
  const status = new Map(db.select().from(s.priceStatus).all().map((r) => [r.ticker, r]));

  const todo: { ticker: string; start: string; full: boolean }[] = [];
  for (const n of needs) {
    const st = status.get(n.ticker);
    const wantStart = addDays(n.first, -HISTORY_DAYS);
    const wantEnd = [addDays(n.last, AFTER_DAYS), today].sort()[0];
    if (st?.statut === "introuvable" && st.dernierAppel > addDays(today, -30)) continue; // réessai mensuel
    if (st?.statut === "erreur" && st.dernierAppel > new Date(Date.now() - 6 * 3600_000).toISOString()) continue;
    if (!st?.premiereDate || st.premiereDate > addDays(wantStart, 7)) todo.push({ ticker: n.ticker, start: wantStart, full: true });
    else if (st.derniereDate! < addDays(wantEnd, -3)) todo.push({ ticker: n.ticker, start: addDays(st.derniereDate!, 1), full: false });
  }
  // Priorité : actions sans aucun cours, puis mises à jour (ordre = publication la plus récente)
  todo.sort((a, b) => Number(b.full) - Number(a.full));

  let lues = 0, nouvelles = 0, faits = 0;
  const details: string[] = [];
  // Cryptos de « Mon portefeuille » (avant les actions : le quota Tiingo est souvent épuisé en fin de passage) : paire Tiingo (ex. btcusd), 2 ans d'historique puis mise à jour
  for (const a of actifs.filter((x) => x.cotation === "crypto" && x.indice)) {
    const st = status.get(a.ticker);
    if (st?.derniereDate && st.derniereDate >= addDays(today, -1)) continue;
    const start = st?.derniereDate ? addDays(st.derniereDate, 1) : addDays(today, -730);
    const now = new Date().toISOString();
    try {
      const res = await getJson<{ priceData: { date: string; open: number; high: number; low: number; close: number; volume: number }[] }[]>(
        `https://api.tiingo.com/tiingo/crypto/prices?tickers=${encodeURIComponent(a.indice!.toLowerCase())}&startDate=${start}&resampleFreq=1day`,
        { userAgent: TOOL_UA, cacheTtl: 0, headers: { Authorization: `Token ${key}` } });
      faits++;
      const rows = (res[0]?.priceData ?? []).filter((b) => b.close > 0).map((b) => ({ ticker: a.ticker, date: b.date.slice(0, 10), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, closeBrut: b.close }));
      lues += rows.length; nouvelles += rows.length;
      db.transaction((tx) => { for (const r of rows) tx.insert(s.prices).values(r).onConflictDoUpdate({ target: [s.prices.ticker, s.prices.date], set: { open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, closeBrut: r.closeBrut } }).run(); });
      const sp = db.get<{ a: string | null; b: string | null }>(sql`SELECT MIN(date) a, MAX(date) b FROM prices WHERE ticker = ${a.ticker}`);
      upsertStatus(db, { ticker: a.ticker, statut: "ok", premiereDate: sp?.a ?? start, derniereDate: sp?.b ?? today, dernierAppel: now, erreur: null });
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) { details.push("Quota Tiingo atteint : reprise au prochain passage"); break; }
      details.push(`${a.ticker} (crypto ${a.indice}) : ${(e as Error).message}`);
    }
  }
  for (const job of todo.slice(0, Math.max(0, budget - faits))) {
    const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(tiingoSymbol(job.ticker))}/prices?startDate=${job.start}&endDate=${today}`;
    const now = new Date().toISOString();
    try {
      const bars = await getJson<TiingoBar[]>(url, { userAgent: TOOL_UA, cacheTtl: 0, headers: { Authorization: `Token ${key}` } });
      faits++;
      lues += bars.length;
      const rows = bars.filter((b) => b.adjClose > 0).map((b) => ({
        ticker: job.ticker, date: b.date.slice(0, 10), open: b.adjOpen, high: b.adjHigh, low: b.adjLow, close: b.adjClose, volume: b.adjVolume, closeBrut: b.close,
      }));
      db.transaction((tx) => {
        for (const r of rows) tx.insert(s.prices).values(r).onConflictDoUpdate({ target: [s.prices.ticker, s.prices.date], set: { open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, closeBrut: r.closeBrut } }).run();
      });
      nouvelles += rows.length;
      const span = db.get<{ a: string | null; b: string | null }>(sql`SELECT MIN(date) a, MAX(date) b FROM prices WHERE ticker = ${job.ticker}`);
      // Si Tiingo n'a rien avant une date (introduction en bourse récente), on note la date demandée pour ne pas redemander.
      const premiere = job.full ? [job.start, span?.a ?? job.start].sort()[0] : status.get(job.ticker)?.premiereDate ?? span?.a ?? null;
      upsertStatus(db, { ticker: job.ticker, statut: "ok", premiereDate: premiere, derniereDate: span?.b ?? today, dernierAppel: now, erreur: null });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        upsertStatus(db, { ticker: job.ticker, statut: "introuvable", premiereDate: null, derniereDate: null, dernierAppel: now, erreur: "symbole inconnu de Tiingo" });
        details.push(`${job.ticker} : inconnu de Tiingo`);
        continue;
      }
      if (e instanceof HttpError && e.status === 429) { details.push("Quota Tiingo atteint : reprise au prochain passage"); break; }
      upsertStatus(db, { ticker: job.ticker, statut: "erreur", premiereDate: status.get(job.ticker)?.premiereDate ?? null, derniereDate: status.get(job.ticker)?.derniereDate ?? null, dernierAppel: now, erreur: (e as Error).message });
      details.push(`${job.ticker} : ${(e as Error).message}`);
    }
  }
  if (jour.length) details.push(`Cours du jour de mon portefeuille (Finnhub) : ${jour.join(", ")}`);
  const reste = Math.max(0, todo.length - faits);
  for (const r of processImports(db)) details.push(`Import ${r.ticker} : ${r.statut} (${r.detail})`);
  const an = refreshAnalyses(db);
  details.push(`${an.ok} opération(s) analysées, ${an.insuffisant} avec un historique trop court`);
  details.unshift(`${faits} action(s) mises à jour, ${reste} en attente (quota Tiingo)`);
  return { lues, nouvelles, details, donneesAu: db.get<{ d: string }>(sql`SELECT MAX(date) d FROM prices`)?.d ?? null };
};

function upsertStatus(db: Db, v: typeof s.priceStatus.$inferInsert) {
  db.insert(s.priceStatus).values(v).onConflictDoUpdate({ target: s.priceStatus.ticker, set: v }).run();
}
export { eq };
