import type { Bar } from "../ta/indicators";
import { ITEMS_8K, ITEMS_8K_MAJEURS, THEMES, type ThemeId } from "./classify";

export interface NewsItem {
  date: string; heure?: string | null; kind: "officiel" | "presse"; titre: string; resume?: string | null;
  source?: string | null; url?: string | null; items?: string | null; themes?: string | null; ton?: number | null;
}

export interface TradeCtx {
  sens: "achat" | "vente"; refDate: string; source: string; operation: string;
  /** 13F : période du trimestre (date exacte inconnue). */ periode?: { debut: string; fin: string } | null;
}

export type Confiance = "forte" | "moyenne" | "faible";
export interface Hypothese { titre: string; confiance: Confiance; preuves: string[]; accord: "explique" | "contre" | "neutre" }
export interface TimelineEvent {
  date: string; kind: "officiel" | "presse" | "cours" | "operation"; titre: string; detail?: string;
  source?: string | null; url?: string | null; themes: string[]; ton: number; reaction?: number | null; jours: number;
}
export interface MarketCtx { action5: number | null; action20: number | null; spy5: number | null; spy20: number | null; qqq5: number | null; qqq20: number | null; jourJ: number | null; plusHaut52: number | null }
export interface NewsAnalysis {
  resume: string;
  hypotheses: Hypothese[];
  contexte: MarketCtx;
  chronologie: TimelineEvent[];
  themes: { id: string; label: string; n: number; ton: number }[];
  couverture: { officiel: number; presse: number; presseDisponible: boolean; note?: string };
}

const DAY = 86400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const pct = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d).replace(".", ",")} %`;
const idxOnOrBefore = (bars: Bar[], date: string) => { let r = -1; for (let i = 0; i < bars.length && bars[i].date <= date; i++) r = i; return r; };
const idxOnOrAfter = (bars: Bar[], date: string) => bars.findIndex((b) => b.date >= date);
const perf = (bars: Bar[], i: number, n: number) => (i - n >= 0 && i >= 0 ? bars[i].close / bars[i - n].close - 1 : null);
/** Variation de la séance où la nouvelle a été connue (premier jour de cotation à partir de la date). */
function reactionAt(bars: Bar[], date: string): number | null {
  const i = idxOnOrAfter(bars, date);
  return i > 0 ? bars[i].close / bars[i - 1].close - 1 : null;
}
const labelTheme = (t: string) => (THEMES as Record<string, { label: string }>)[t]?.label ?? t;

/** Le titre cite-t-il la société (nom court, premier mot distinctif du nom, symbole) ? */
export function mentions(title: string, aliases: string[]): boolean {
  return aliases.some((a) => {
    if (!a) return false;
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Symbole : en capitales, mot entier (ou précédé de $) ; nom : insensible à la casse
    return /^[A-Z.]{1,5}$/.test(a) ? (a.length >= 2 && new RegExp(`(^|[^A-Za-z])\\$?${esc}([^A-Za-z]|$)`).test(title)) : new RegExp(`\\b${esc}\\b`, "i").test(title);
  });
}

export function explainWithNews(t: TradeCtx, bars: Bar[], spy: Bar[], qqq: Bar[], news: NewsItem[], presseDisponible: boolean, note?: string, aliases: string[] = []): NewsAnalysis {
  const ref = t.refDate;
  const winStart = t.periode?.debut ?? new Date(Date.parse(ref) - 14 * DAY).toISOString().slice(0, 10);
  const i = idxOnOrBefore(bars, ref), si = idxOnOrBefore(spy, ref), qi = idxOnOrBefore(qqq, ref);
  const hi52 = i >= 0 ? Math.max(...bars.slice(Math.max(0, i - 250), i + 1).map((b) => b.high)) : null;
  const contexte: MarketCtx = {
    action5: perf(bars, i, 5), action20: perf(bars, i, 20), spy5: perf(spy, si, 5), spy20: perf(spy, si, 20), qqq5: perf(qqq, qi, 5), qqq20: perf(qqq, qi, 20),
    jourJ: perf(bars, i, 1), plusHaut52: hi52 && i >= 0 ? bars[i].close / hi52 - 1 : null,
  };
  const verbe = t.sens === "achat" ? "achat" : "vente";
  const leVerbe = t.sens === "achat" ? "l'achat" : "la vente";

  // --- Chronologie ---
  const inWin = (d: string, after = 3) => d >= winStart && days(ref, d) <= after;
  const official = news.filter((n) => n.kind === "officiel" && days(ref, n.date) <= 5 && days(n.date, ref) <= (t.periode ? 120 : 60));
  const allPress = dedupe(news.filter((n) => n.kind === "presse" && inWin(n.date)));
  // Articles qui citent la société / articles de marché (le reste est écarté : bruit de la recherche plein texte)
  const press = aliases.length ? allPress.filter((n) => mentions(n.titre, aliases)) : allPress;
  const marketPress = allPress.filter((n) => !press.includes(n) && (n.themes ?? "").split(",").includes("marche"));
  const chronologie: TimelineEvent[] = [];
  for (const n of official) {
    const items = (n.items ?? "").split(",").filter((x) => ITEMS_8K_MAJEURS.has(x));
    chronologie.push({
      date: n.date, kind: "officiel", titre: items.map((x) => ITEMS_8K[x]).join(" · ") || "Déclaration 8-K", detail: n.resume ?? n.titre,
      source: "SEC EDGAR (8-K)", url: n.url, themes: (n.themes ?? "").split(",").filter(Boolean).map(labelTheme), ton: n.ton ?? 0,
      reaction: reactionAt(bars, n.date), jours: days(ref, n.date),
    });
  }
  // Presse : les articles les plus informatifs (avec thème), puis les plus proches de l'opération
  const scored = [...press, ...marketPress.slice(0, 4)].map((n) => ({ n, score: (n.themes ? n.themes.split(",").filter((x) => x && x !== "marche" && x !== "initie").length * 2 : 0) + (n.ton ? 1 : 0) - Math.abs(days(ref, n.date)) * 0.15 }))
    .sort((a, b) => b.score - a.score).slice(0, 18).map((x) => x.n);
  for (const n of scored) chronologie.push({
    date: n.date, kind: "presse", titre: n.titre, detail: press.includes(n) ? undefined : "Contexte de marché (ne cite pas la société)", source: n.source, url: n.url, themes: (n.themes ?? "").split(",").filter(Boolean).map(labelTheme), ton: n.ton ?? 0,
    reaction: reactionAt(bars, n.date), jours: days(ref, n.date),
  });
  // Fortes séances (au moins 2,5 fois la variation moyenne, ou 5 %)
  if (i > 25) {
    const moves = bars.slice(i - 60 > 1 ? i - 60 : 1, i + 1).map((b, k, arr) => (k ? Math.abs(b.close / arr[k - 1].close - 1) : 0));
    const avg = moves.reduce((a, b) => a + b, 0) / Math.max(1, moves.length - 1);
    for (let k = Math.max(1, idxOnOrAfter(bars, winStart)); k <= Math.min(bars.length - 1, i + 3); k++) {
      const ch = bars[k].close / bars[k - 1].close - 1;
      if (Math.abs(ch) >= Math.max(0.05, 2.5 * avg)) {
        const vAvg = bars.slice(Math.max(0, k - 20), k).reduce((a, b) => a + b.volume, 0) / Math.min(20, k);
        const mkt = qqq[idxOnOrBefore(qqq, bars[k].date)], mktPrev = qqq[idxOnOrBefore(qqq, bars[k].date) - 1];
        const mch = mkt && mktPrev ? mkt.close / mktPrev.close - 1 : null;
        chronologie.push({
          date: bars[k].date, kind: "cours", titre: `Séance ${pct(ch)}${vAvg ? ` · volume ${(bars[k].volume / vAvg).toFixed(1).replace(".", ",")}× la moyenne` : ""}`,
          detail: mch != null ? `Nasdaq 100 ce jour-là : ${pct(mch)}${Math.abs(ch - mch) > Math.abs(mch) ? " → mouvement surtout propre à l'action" : " → mouvement surtout lié au marché"}` : undefined,
          themes: [], ton: ch > 0 ? 1 : -1, reaction: ch, jours: days(ref, bars[k].date),
        });
      }
    }
  }
  chronologie.push({ date: ref, kind: "operation", titre: t.periode ? `Fin du trimestre déclaré (opérations entre le ${t.periode.debut} et le ${t.periode.fin})` : `Jour de ${leVerbe}`, themes: [], ton: 0, jours: 0 });
  const order = { officiel: 0, cours: 1, presse: 2, operation: 3 } as const;
  chronologie.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  // --- Thèmes dominants ---
  const tcount = new Map<string, { n: number; ton: number }>();
  for (const n of [...press, ...official]) for (const th of (n.themes ?? "").split(",").filter(Boolean)) {
    const e = tcount.get(th) ?? { n: 0, ton: 0 }; e.n++; e.ton += n.ton ?? 0; tcount.set(th, e);
  }
  const themes = [...tcount.entries()].map(([id, v]) => ({ id, label: labelTheme(id), n: v.n, ton: v.n ? v.ton / v.n : 0 })).sort((a, b) => b.n - a.n);

  // --- Hypothèses ---
  const H: Hypothese[] = [];
  const add = (h: Hypothese) => H.push(h);
  const sameDir = (ton: number) => (ton === 0 ? "neutre" : (ton > 0) === (t.sens === "achat") ? "explique" : "contre");

  // 1. Résultats publiés peu avant
  const res = official.filter((n) => (n.items ?? "").split(",").includes("2.02") && days(n.date, ref) >= 0 && days(n.date, ref) <= (t.periode ? 100 : 30))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (res) {
    const raw = reactionAt(bars, res.date), d = days(res.date, ref);
    const mkt = reactionAt(qqq, res.date);
    // Réaction propre à l'action : variation du jour moins celle du Nasdaq 100
    const r = raw != null && mkt != null ? raw - mkt : raw;
    const annonce = res.resume ?? "";
    const tonAnnonce = /\b(raises?|record|beats?|increases?|strong|exceeds?|growth)\b/i.test(annonce) ? 1 : /\b(lowers?|cuts?|miss(es)?|declines?|weak|loss)\b/i.test(annonce) ? -1 : 0;
    const preuves = [`8-K « Résultats financiers » déposé le ${res.date}, ${d} jour(s) avant ${leVerbe}.`];
    if (annonce) preuves.push(`Communiqué : « ${annonce.slice(0, 260)}${annonce.length > 260 ? "…" : ""} »${tonAnnonce > 0 ? " (annonce positive)" : tonAnnonce < 0 ? " (annonce négative)" : ""}.`);
    if (raw != null) preuves.push(`Réaction du cours ce jour-là : ${pct(raw)}${mkt != null ? `, pour un Nasdaq 100 à ${pct(mkt)} → réaction propre à l'action ${pct(r!)}` : ""}.`);
    const neg = r != null && r <= -0.03, pos = r != null && r >= 0.03;
    if (raw != null && mkt != null && Math.abs(r!) < 0.03 && Math.abs(raw) >= 0.03) preuves.push("Le mouvement du jour tient surtout au marché, pas aux résultats.");
    if (tonAnnonce > 0 && neg) preuves.push("Annonce favorable mais mal reçue par le marché : les attentes étaient sans doute plus élevées.");
    const titre = !neg && !pos ? `${t.sens === "achat" ? "Achat" : "Vente"} dans les jours qui suivent la publication des résultats${tonAnnonce > 0 ? " (annonce favorable)" : tonAnnonce < 0 ? " (annonce défavorable)" : ""}`
      : t.sens === "achat" ? (neg ? "Achat après des résultats mal accueillis (achat dans la faiblesse)" : "Achat après des résultats salués (suivre la dynamique)")
      : (pos ? "Vente après des résultats salués (prise de bénéfices)" : "Vente après des résultats mal accueillis");
    add({ titre, confiance: d <= 10 ? "forte" : "moyenne", preuves, accord: "explique" });
  }

  // 2. Marché général
  const { action5: a5, action20: a20, qqq5: q5, qqq20: q20, spy5: s5 } = contexte;
  if (q5 != null && a5 != null && Math.abs(q5) >= 0.03) {
    const marketNews = [...marketPress, ...press.filter((n) => (n.themes ?? "").includes("marche"))].slice(0, 3).map((n) => `« ${n.titre} » (${n.source}, ${n.date})`);
    const down = q5 < 0;
    const titre = t.sens === "achat"
      ? (down ? "Achat dans un repli général du marché" : "Achat porté par un marché en hausse")
      : (down ? "Vente dans un marché en baisse (réduction du risque)" : "Vente en profitant d'un marché en hausse");
    add({ titre, confiance: Math.abs(q5) >= 0.05 ? "forte" : "moyenne", accord: "explique",
      preuves: [`Nasdaq 100 sur 5 séances : ${pct(q5)} ; S&P 500 : ${s5 != null ? pct(s5) : "—"} ; l'action : ${pct(a5)}.`, ...marketNews] });
  }

  // 3. Mouvement propre à l'action (écart avec le Nasdaq)
  if (a5 != null && q5 != null && Math.abs(a5 - q5) >= 0.05) {
    const spec = a5 - q5;
    const specNews = press.filter((n) => (n.ton ?? 0) === (spec < 0 ? -1 : 1) && !(n.themes ?? "").includes("marche")).slice(0, 3).map((n) => `« ${n.titre} » (${n.source}, ${n.date})`);
    const titre = spec < 0
      ? (t.sens === "achat" ? "Achat d'une action qui a décroché plus que le marché" : "Vente d'une action en difficulté propre")
      : (t.sens === "achat" ? "Achat d'une action en forte dynamique propre" : "Prise de bénéfices après une surperformance");
    add({ titre, confiance: Math.abs(spec) >= 0.1 ? "forte" : "moyenne", accord: "explique",
      preuves: [`Sur 5 séances, l'action fait ${pct(a5)} contre ${pct(q5)} pour le Nasdaq 100 (écart ${pct(spec)}).`, ...specNews] });
  }

  // 4. Forte variation sur un mois
  if (a20 != null && Math.abs(a20) >= 0.2) {
    const up = a20 > 0;
    add({ titre: up ? (t.sens === "vente" ? `Prise de bénéfices après ${pct(a20, 0)} en un mois` : `Achat après ${pct(a20, 0)} en un mois (dynamique)`)
                    : (t.sens === "achat" ? `Achat après une chute de ${pct(a20, 0)} en un mois` : `Vente après une chute de ${pct(a20, 0)} en un mois (limiter les pertes)`),
      confiance: Math.abs(a20) >= 0.3 ? "forte" : "moyenne", accord: "explique",
      preuves: [`Action sur 20 séances : ${pct(a20)} (Nasdaq 100 : ${q20 != null ? pct(q20) : "—"}).`, ...(contexte.plusHaut52 != null ? [`Cours à ${pct(contexte.plusHaut52)} de son plus haut d'un an.`] : [])] });
  }

  // 5. Événements spécifiques (presse et 8-K récents)
  const SPECIFIC: ThemeId[] = ["operation", "contrat", "analystes", "previsions", "reglementation", "dirigeants", "produit", "rachat"];
  for (const th of SPECIFIC) {
    const hits = [...official, ...press].filter((n) => (n.themes ?? "").split(",").includes(th) && days(n.date, ref) >= -1 && days(n.date, ref) <= (t.periode ? 100 : 14));
    if (!hits.length || (th === "previsions" && res)) continue;
    const best = hits.sort((a, b) => Math.abs((b.ton ?? 0)) - Math.abs((a.ton ?? 0)) || b.date.localeCompare(a.date))[0];
    const ton = Math.sign(hits.reduce((a, n) => a + (n.ton ?? 0), 0));
    const d = days(best.date, ref);
    const label = labelTheme(th);
    add({
      titre: `Réaction à l'actualité : ${label.toLowerCase()}`,
      confiance: d <= 5 && hits.length >= 2 ? "moyenne" : "faible",
      accord: sameDir(ton),
      preuves: [
        `${hits.length} nouvelle(s) sur ce thème ; la plus marquante : « ${best.kind === "officiel" ? best.resume ?? best.titre : best.titre} » (${best.kind === "officiel" ? "8-K" : best.source}, ${best.date}).`,
        ton === 0 ? "Tonalité partagée." : `Tonalité ${ton > 0 ? "plutôt positive" : "plutôt négative"} : ${sameDir(ton) === "explique" ? `cohérent avec ${t.sens === "achat" ? "un achat" : "une vente"}` : `à contre-pied d'${t.sens === "achat" ? "un achat" : "une vente"}`}.`,
      ],
    });
  }

  // 6. Opérations sans lien probable avec l'actualité
  const op = t.operation.toLowerCase();
  if (t.source === "FORM4" && (op.includes("après exercice") || op.startsWith("retenue") || op.includes("attribution") || op.includes("exercice") || op.includes("don"))) {
    H.unshift({ titre: "Opération liée à la rémunération ou au patrimoine, sans doute indépendante de l'actualité", confiance: "forte", accord: "neutre",
      preuves: [`Type déclaré : « ${t.operation} ». Ces opérations suivent un calendrier (acquisition des droits, échéance des options, plan 10b5-1, impôts), pas les nouvelles du jour.`] });
  }
  if (!H.length) H.push({ titre: "Aucune nouvelle marquante : décision probablement de fond", confiance: "faible", accord: "neutre",
    preuves: [presseDisponible ? "Ni annonce officielle ni article notable autour de l'opération, et pas de mouvement de marché marqué." : "Pas d'annonce officielle notable ; archive de presse indisponible pour cette date.", "Les gérants agissent souvent sur la valorisation, la pondération du portefeuille ou des flux de souscriptions."] });

  const rank = { forte: 0, moyenne: 1, faible: 2 } as const;
  H.sort((a, b) => rank[a.confiance] - rank[b.confiance]);

  // --- Résumé ---
  const parts: string[] = [];
  const top = H.filter((h) => h.accord !== "contre").slice(0, 2);
  if (top.length) parts.push(`Explication la plus probable : ${top.map((h) => h.titre.charAt(0).toLowerCase() + h.titre.slice(1)).join(" ; ")}.`);
  if (a5 != null && q5 != null) parts.push(`Sur les 5 séances précédentes, l'action fait ${pct(a5)} contre ${pct(q5)} pour le Nasdaq 100.`);
  parts.push(`${official.length} annonce(s) officielle(s) et ${press.length} article(s) de presse trouvés${presseDisponible ? "" : " (presse indisponible pour cette période)"}${themes.length ? `, surtout sur : ${themes.slice(0, 3).map((x) => x.label.toLowerCase()).join(", ")}` : ""}.`);

  return { resume: parts.join(" "), hypotheses: H, contexte, chronologie, themes, couverture: { officiel: official.length, presse: press.length, presseDisponible, note } };
}

/** Retire les quasi-doublons de titres (même article repris par plusieurs sites). */
function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((n) => {
    const k = n.titre.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3).slice(0, 7).join(" ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
