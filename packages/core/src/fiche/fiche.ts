import type { Bar } from "../ta/indicators";
import type { Fundamentals } from "./fundamentals";

/** Une opération, sous la forme utile au calcul des signaux. */
export interface OpLite {
  source: string; sens: "achat" | "vente"; qui: string; operation: string; datePublication: string; dateOperation: string | null;
  montantUsd: number | null; trimestre?: string | null; poidsPct?: number | null; rang?: number | null;
}
export interface TrackRecord { acteur: string; n: number; perf20: number | null; perf60: number | null; reussite: number | null }

const DAY = 86400_000;
const shift = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

/** Nom d'acteur commun à toutes les sources (« Cathie Wood (ARK · ARKW) » -> « Cathie Wood (ARK) »). */
export function acteurOf(o: Pick<OpLite, "source" | "qui">): string {
  if (o.source === "ARK") return "Cathie Wood (ARK)";
  if (o.source === "TRUMP") return "Donald Trump";
  return o.qui.replace(/\s*\(.*\)$/, "").trim();
}

/** Ventes « techniques » (rémunération, impôts) : elles ne disent rien de l'opinion du vendeur. */
export const isCompensation = (o: Pick<OpLite, "source" | "operation">) =>
  o.source === "FORM4" && /après exercice|retenue|attribution|exercice|don\b|conversion|annulation|renonciation|réception/i.test(o.operation);

// ------------------------------------------------------------------ Risque et marché

export interface Risque {
  cours: number | null; dateCours: string | null;
  volatilite: number | null; beta: number | null; pireBaisse: number | null; liquiditeUsd: number | null;
  force3m: number | null; force6m: number | null; force12m: number | null; perf12m: number | null; distancePlusHaut: number | null;
}

export function risque(bars: Bar[], spy: Bar[], qqq: Bar[], closeBrut?: number | null): Risque {
  const n = bars.length;
  const empty: Risque = { cours: null, dateCours: null, volatilite: null, beta: null, pireBaisse: null, liquiditeUsd: null, force3m: null, force6m: null, force12m: null, perf12m: null, distancePlusHaut: null };
  if (n < 30) return { ...empty, cours: bars.at(-1)?.close ?? null, dateCours: bars.at(-1)?.date ?? null };
  const last = bars[n - 1];
  const yr = bars.slice(Math.max(0, n - 252));
  const rets = yr.slice(1).map((b, i) => b.close / yr[i].close - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
  // Bêta : covariance avec le S&P 500 (SPY) sur les mêmes séances
  const spyBy = new Map(spy.map((b) => [b.date, b.close]));
  const pairs: [number, number][] = [];
  for (let i = 1; i < yr.length; i++) {
    const a = spyBy.get(yr[i].date), b = spyBy.get(yr[i - 1].date);
    if (a && b) pairs.push([yr[i].close / yr[i - 1].close - 1, a / b - 1]);
  }
  let beta: number | null = null;
  if (pairs.length > 60) {
    const mx = pairs.reduce((s, p) => s + p[1], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
    const cov = pairs.reduce((s, p) => s + (p[0] - my) * (p[1] - mx), 0), vx = pairs.reduce((s, p) => s + (p[1] - mx) ** 2, 0);
    beta = vx ? cov / vx : null;
  }
  let peak = -Infinity, dd = 0;
  for (const b of yr) { peak = Math.max(peak, b.close); dd = Math.min(dd, b.close / peak - 1); }
  const liq = bars.slice(-20).reduce((a, b) => a + b.close * b.volume, 0) / Math.min(20, n);
  const perfOver = (s: Bar[], k: number) => (s.length > k ? s[s.length - 1].close / s[s.length - 1 - k].close - 1 : null);
  const rel = (k: number) => { const a = perfOver(bars, k), q = perfOver(qqq, k); return a != null && q != null ? a - q : null; };
  return {
    cours: closeBrut ?? last.close, dateCours: last.date, volatilite: vol, beta, pireBaisse: dd, liquiditeUsd: liq,
    force3m: rel(63), force6m: rel(126), force12m: rel(252), perf12m: perfOver(bars, 252),
    distancePlusHaut: last.close / Math.max(...yr.map((b) => b.high)) - 1,
  };
}

// ------------------------------------------------------------------ Signaux « smart money »

export interface SmartMoney {
  depuis: string;
  acheteurs: { acteur: string; source: string; date: string }[];
  vendeurs: { acteur: string; source: string; date: string }[];
  ventesTechniques: number;
  achatsInities: { n: number; acteurs: string[]; montant: number; groupe: boolean; fenetre: string | null };
  fonds: { acteur: string; operation: string; trimestre: string; poidsPct: number | null; rang: number | null }[];
  retard: { mediane: number | null; details: { acteur: string; date: string; perf: number }[] };
  historique: TrackRecord[];
  score: number;
  scoreDetail: string[];
}

export function smartMoney(ops: OpLite[], bars: Bar[], today: string, track: Map<string, TrackRecord>): SmartMoney {
  const depuis = shift(today, -90);
  const recent = ops.filter((o) => o.datePublication >= depuis);
  const uniq = (list: OpLite[]) => {
    const m = new Map<string, { acteur: string; source: string; date: string }>();
    for (const o of list) { const a = acteurOf(o); const prev = m.get(a); if (!prev || o.datePublication > prev.date) m.set(a, { acteur: a, source: o.source, date: o.datePublication }); }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
  };
  const acheteurs = uniq(recent.filter((o) => o.sens === "achat" && !isCompensation(o)));
  const vendeurs = uniq(recent.filter((o) => o.sens === "vente" && !isCompensation(o)));
  const ventesTechniques = recent.filter((o) => o.sens === "vente" && isCompensation(o)).length;

  // Achats d'initiés sur le marché (180 jours) : le plus grand nombre d'initiés distincts dans une fenêtre de 30 jours
  const ib = ops.filter((o) => o.source === "FORM4" && /^achat/i.test(o.operation) && o.datePublication >= shift(today, -180));
  let best: OpLite[] = [];
  for (const o of ib) {
    const d = o.dateOperation ?? o.datePublication;
    const win = ib.filter((x) => { const e = x.dateOperation ?? x.datePublication; return e >= d && e <= shift(d, 30); });
    if (new Set(win.map(acteurOf)).size > new Set(best.map(acteurOf)).size) best = win;
  }
  const achatsInities = {
    n: new Set(best.map(acteurOf)).size, acteurs: [...new Set(best.map(acteurOf))], montant: best.reduce((a, o) => a + (o.montantUsd ?? 0), 0),
    groupe: new Set(best.map(acteurOf)).size >= 2,
    fenetre: best.length ? `${best.map((o) => o.dateOperation ?? o.datePublication).sort()[0]} → ${best.map((o) => o.dateOperation ?? o.datePublication).sort().at(-1)}` : null,
  };

  // 13F : dernier trimestre déclaré par chaque fonds
  const lastQ = new Map<string, OpLite>();
  for (const o of ops.filter((x) => x.source === "13F")) { const a = acteurOf(o); const p = lastQ.get(a); if (!p || o.datePublication > p.datePublication) lastQ.set(a, o); }
  const fonds = [...lastQ.values()].map((o) => ({ acteur: acteurOf(o), operation: o.operation, trimestre: o.trimestre ?? "", poidsPct: o.poidsPct ?? null, rang: o.rang ?? null }));

  // Retard du suiveur : évolution du cours depuis chaque achat récent
  const lastClose = bars.at(-1)?.close;
  const at = (date: string) => { let r: Bar | undefined; for (const b of bars) { if (b.date > date) break; r = b; } return r; };
  const details = acheteurs.flatMap((a) => {
    const o = recent.find((x) => acteurOf(x) === a.acteur && x.sens === "achat")!;
    const b = at(o.dateOperation ?? o.datePublication);
    return b && lastClose ? [{ acteur: a.acteur, date: o.dateOperation ?? o.datePublication, perf: lastClose / b.close - 1 }] : [];
  });
  const sorted = details.map((d) => d.perf).sort((a, b) => a - b);
  const mediane = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

  const historique = [...new Set([...acheteurs, ...vendeurs].map((a) => a.acteur))].flatMap((a) => (track.has(a) ? [track.get(a)!] : []));

  // Score « smart money » (0–100), règles transparentes
  const detail: string[] = [];
  let score = 0;
  const pts = (n: number, why: string) => { score += n; detail.push(`${n > 0 ? "+" : ""}${n} ${why}`); };
  // Poids par source : un initié ou un fonds qui engage son argent pèse plus qu'un élu (souvent un gérant)
  // ou que Donald Trump (milliers de petites transactions, gestion vraisemblablement déléguée).
  const w = (src: string) => (src === "TRUMP" ? 5 : src === "CONGRES" ? 10 : 15);
  const buyPts = acheteurs.reduce((a, x) => a + w(x.source), 0);
  if (acheteurs.length) pts(Math.min(45, buyPts), `${acheteurs.length} acheteur(s) distinct(s) sur 90 jours (${acheteurs.map((x) => `${x.acteur} ${w(x.source)}`).join(", ")})`);
  if (achatsInities.groupe) pts(20, `achats groupés d'initiés (${achatsInities.n} dirigeants en 30 jours)`);
  else if (achatsInities.n === 1) pts(10, "un initié a acheté sur le marché");
  const nouvelles = fonds.filter((f) => f.operation === "Nouvelle position").length;
  if (nouvelles) pts(Math.min(20, nouvelles * 10), `${nouvelles} nouvelle(s) position(s) de grands fonds`);
  const fortes = fonds.filter((f) => (f.rang != null && f.rang <= 10) && (f.operation === "Nouvelle position" || f.operation === "Renforcement")).length;
  if (fortes) pts(10, "renforcée dans le top 10 d'un grand fonds");
  const sellPts = vendeurs.reduce((a, x) => a + (x.source === "TRUMP" ? 3 : x.source === "CONGRES" ? 6 : 10), 0);
  if (vendeurs.length) pts(-Math.min(30, sellPts), `${vendeurs.length} vendeur(s) distinct(s) sur 90 jours, hors ventes de rémunération`);
  score = Math.max(0, Math.min(100, score));
  return { depuis, acheteurs, vendeurs, ventesTechniques, achatsInities, fonds, retard: { mediane, details }, historique, score, scoreDetail: detail };
}

// ------------------------------------------------------------------ Valorisation et santé financière

export interface Finances {
  arrete: string | null; capitalisation: number | null; per: number | null; prixVentes: number | null;
  croissanceCa: number | null; croissanceNet: number | null; margeNette: number | null; fcf: number | null; rendementFcf: number | null;
  detteNette: number | null; detteSurFp: number | null; variationActions: number | null; revenuTtm: number | null; netTtm: number | null; bpaTtm: number | null;
  lectures: string[];
}

export function finances(f: Fundamentals | null, cours: number | null): Finances | null {
  if (!f) return null;
  const cap = f.actions && cours ? f.actions * cours : null;
  const fcf = f.cfoTtm != null ? f.cfoTtm - (f.capexTtm ?? 0) : null;
  const g = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b - 1 : null);
  const out: Finances = {
    arrete: f.arrete, capitalisation: cap,
    per: f.bpaTtm && f.bpaTtm > 0 && cours ? cours / f.bpaTtm : null,
    prixVentes: cap && f.revenuTtm ? cap / f.revenuTtm : null,
    croissanceCa: g(f.revenuTtm, f.revenuTtmPrec), croissanceNet: g(f.netTtm, f.netTtmPrec),
    margeNette: f.netTtm != null && f.revenuTtm ? f.netTtm / f.revenuTtm : null,
    fcf, rendementFcf: fcf != null && cap ? fcf / cap : null,
    detteNette: f.dette != null || f.tresorerie != null ? (f.dette ?? 0) - (f.tresorerie ?? 0) : null,
    detteSurFp: f.dette != null && f.fondsPropres && f.fondsPropres > 0 ? f.dette / f.fondsPropres : null,
    variationActions: f.actions && f.actions1an ? f.actions / f.actions1an - 1 : null,
    revenuTtm: f.revenuTtm, netTtm: f.netTtm, bpaTtm: f.bpaTtm, lectures: [],
  };
  const L = out.lectures;
  if ((out.margeNette != null && Math.abs(out.margeNette) > 1) || (out.croissanceCa != null && out.croissanceCa > 2)) {
    L.push("Attention : comptes atypiques (banque, foncière, société financière ou changement de périmètre) ; ces ratios sont à lire avec prudence.");
  }
  if (out.per != null) L.push(out.per < 12 ? "Valorisation basse (PER < 12) : marché sceptique ou action délaissée." : out.per > 40 ? "Valorisation élevée (PER > 40) : beaucoup de croissance déjà dans le prix." : "Valorisation dans la moyenne (PER entre 12 et 40).");
  else if (out.netTtm != null && out.netTtm < 0) L.push("Société en perte sur 12 mois : PER non significatif.");
  if (out.croissanceCa != null) L.push(out.croissanceCa > 0.2 ? "Forte croissance du chiffre d'affaires (plus de 20 % sur un an)." : out.croissanceCa < 0 ? "Chiffre d'affaires en recul sur un an." : "Croissance modérée du chiffre d'affaires.");
  if (out.detteSurFp != null && out.detteSurFp > 2) L.push("Endettement élevé (dette supérieure à 2 fois les fonds propres).");
  if (out.detteNette != null && out.detteNette < 0) L.push("Trésorerie supérieure à la dette (trésorerie nette positive).");
  if (out.variationActions != null) L.push(out.variationActions < -0.01 ? "Rachats d'actions : le nombre d'actions baisse (favorable à l'actionnaire)." : out.variationActions > 0.03 ? "Dilution : le nombre d'actions augmente de plus de 3 % sur un an." : "Nombre d'actions stable.");
  if (out.rendementFcf != null) L.push(out.rendementFcf > 0.06 ? "Flux de trésorerie disponible élevé par rapport à la capitalisation (> 6 %)." : out.rendementFcf < 0 ? "Flux de trésorerie disponible négatif : l'entreprise consomme du cash." : "");
  out.lectures = L.filter(Boolean);
  return out;
}

export interface Fiche { ticker: string; activite?: { secteur: string | null; resume: string | null; langue: string | null; wikipedia: string | null } | null; smart: SmartMoney; risque: Risque; finances: Finances | null; financesStatut: string }
