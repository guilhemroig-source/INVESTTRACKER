/**
 * Génère une page HTML autonome (tableau de bord + analyses calculées dans le navigateur) à partir de la base :
 *   pnpm --filter @tracker/web snapshot [sortie.html]
 * Prérequis : `pnpm build` (la feuille de style compilée est reprise de .next/static/css).
 */
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { barsOf, getClassement, getDashboardData, getDb, getFiche, getMirror, getMirrors, newsAnalysisFor, schema as s, todayParis, trackRecords, tradeInput } from "@tracker/core";

const out = path.resolve(process.argv[2] ?? "snapshot.html");
const webDir = path.resolve(import.meta.dirname, "..");
const db = getDb();

const data = getDashboardData(db);
const prices: Record<string, [string[], number[], number[], number[], number[], number[]]> = {};
const k = (x: number) => Math.round(x * 10000) / 10000;
for (const r of db.select().from(s.prices).orderBy(s.prices.ticker, s.prices.date).all()) {
  const p = (prices[r.ticker] ??= [[], [], [], [], [], []]);
  p[0].push(r.date); p[1].push(k(r.open)); p[2].push(k(r.high)); p[3].push(k(r.low)); p[4].push(k(r.close)); p[5].push(Math.round(r.volume));
}
const trades: Record<string, unknown> = {};
for (const o of db.select().from(s.operations).all()) {
  const input = tradeInput(db, o);
  // Nouvelles précalculées (annonces officielles, presse, contexte de marché, hypothèses)
  trades[o.cleUnique] = { ...input, ticker: o.ticker, news: newsAnalysisFor(db, o, input, barsOf(db, o.ticker)) };
}

// Classement et fiches précalculés (une fiche par action ayant au moins une opération)
const today = todayParis();
const classement = getClassement(db, today);
const track = trackRecords(db);
const fiches: Record<string, unknown> = {};
for (const t of new Set(db.select({ t: s.operations.ticker }).from(s.operations).all().map((x) => x.t))) fiches[t] = getFiche(db, t, today, track);

// Portefeuilles miroirs (résumés + détail de ceux qui ont des positions calculables)
const miroirs = getMirrors(db);
const miroirDetails: Record<string, unknown> = {};
for (const m of miroirs.filter((x) => x.couverts > 0)) miroirDetails[m.acteur] = getMirror(db, m.acteur);
// Annonces et presse par action (pages action)
const newsByTicker: Record<string, unknown[]> = {};
for (const n of db.select({ ticker: s.newsItems.ticker, date: s.newsItems.date, kind: s.newsItems.kind, titre: s.newsItems.titre, resume: s.newsItems.resume, source: s.newsItems.source, url: s.newsItems.url, items: s.newsItems.items, ton: s.newsItems.ton }).from(s.newsItems).all()) {
  (newsByTicker[n.ticker] ??= []).push(n);
}
for (const k of Object.keys(newsByTicker)) (newsByTicker[k] as { date: string }[]).sort((a, b) => b.date.localeCompare(a.date));

const bundle = await build({
  entryPoints: [path.join(webDir, "snapshot/entry.tsx")],
  bundle: true, minify: true, format: "iife", write: false, platform: "browser", target: "es2020",
  jsx: "automatic", tsconfig: path.join(webDir, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const cssDir = path.join(webDir, ".next/static/css");
const css = fs.readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(cssDir, f), "utf8")).join("\n");

const payload = JSON.stringify({ data, today, genereLe: new Date().toISOString(), prices, trades, classement, fiches, miroirs, miroirDetails, newsByTicker }).replace(/</g, "\\u003c");

const html = `<title>Tracker des grands investisseurs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,400&display=swap" rel="stylesheet">
<style>
${css}
/* Instantané publié : thème sombre unique, assumé */
:root { color-scheme: dark; }
html, body { background: #05080d; color: #dbe3ee; }
.snap-note { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .72rem; letter-spacing: .04em; color: #ffb547; background: #0b1119;
  border-bottom: 1px solid #1a2331; padding-block: 8px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.snap-note b { color: #dbe3ee; }
</style>
<div id="root"></div>
<script type="application/json" id="tracker-data">${payload}</script>
<script>${js}</script>
`;
fs.writeFileSync(out, html);
console.log(`${out} : ${(html.length / 1024 / 1024).toFixed(2)} Mo (${Object.keys(prices).length} actions avec cours, ${data.operations.length} opérations)`);
