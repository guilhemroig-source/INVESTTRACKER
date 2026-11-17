import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Bar, type PortfolioTx, addCoursManuel, addJournal, addTx, importLignes, mesEntrees, processImports, computePortfolio, getDb, getPortfolio, insertIgnore, listJournal, reviewJournal, schema as s, setRegles, upsertActif } from "../src";

const day = (i: number) => new Date(Date.UTC(2026, 0, 5) + i * 86400_000).toISOString().slice(0, 10);
const bars = (f: (i: number) => number): Bar[] => Array.from({ length: 100 }, (_, i) => ({ date: day(i), open: f(i), high: f(i), low: f(i), close: f(i), volume: 1 }));

describe("calcul du portefeuille", () => {
  const prices: Record<string, number> = { AAA: 150, BBB: 40 };
  const last = (t: string) => (prices[t] ? { cours: prices[t], date: day(99) } : null);
  const ref = { ticker: "VT", libelle: "Monde", bars: bars((i) => 100 + i) }; // 100 -> 199
  const tx: PortfolioTx[] = [
    { date: day(0), type: "achat", ticker: "AAA", quantite: 10, prix: 100, frais: 10, compte: "CTO" },
    { date: day(10), type: "achat", ticker: "AAA", quantite: 10, prix: 120, frais: 10, compte: "CTO" },
    { date: day(20), type: "vente", ticker: "AAA", quantite: 5, prix: 130, frais: 5, compte: "CTO" },
    { date: day(30), type: "dividende", ticker: "AAA", quantite: 0, prix: 20, frais: 0, compte: "CTO" },
    { date: day(40), type: "achat", ticker: "BBB", quantite: 10, prix: 80, frais: 0, compte: "PEA" },
  ];
  const r = computePortfolio(tx, last, ref, { poidsMax: 0.5, baisseMax: 0.25 });
  const a = r.positions.find((p) => p.ticker === "AAA")!, b = r.positions.find((p) => p.ticker === "BBB")!;

  it("prix de revient moyen pondéré, frais inclus ; gain réalisé à la vente", () => {
    expect(a.pru).toBeCloseTo(2220 / 20, 6); // (1010 + 1210) / 20
    expect(a.quantite).toBe(15);
    expect(a.gainRealise).toBeCloseTo(5 * 130 - 5 - 5 * 111, 6);
    expect(a.dividendes).toBe(20);
  });
  it("valeur, gain latent, poids et alertes de risque", () => {
    expect(a.valeur).toBe(2250);
    expect(a.gainLatent).toBeCloseTo(2250 - 15 * 111, 6);
    expect(b.gainLatentPct).toBe(-0.5);
    expect(b.alertes.join(" ")).toMatch(/Perte de 50 %/);
    expect(b.alertes.join(" ")).not.toMatch(/PEA/); // éligibilité contrôlée par getPortfolio
    expect(a.alertes.join(" ")).toMatch(/Pèse 85 %/);
  });
  it("gain total et comparaison avec l'ETF sur les mêmes flux", () => {
    const entrees = 1010 + 1210 + 800, sorties = 645 + 20;
    expect(r.totaux.gainTotal).toBeCloseTo(2250 + 400 + sorties - entrees, 6);
    // ETF : achats de 1010 à 100, 1210 à 110, vente de 645 à 120, achat de 800 à 140 ; cours final 199
    const parts = 1010 / 100 + 1210 / 110 - 645 / 120 + 800 / 140;
    expect(r.reference!.gainTotal!).toBeCloseTo(parts * 199 + 645 - entrees, 6);
  });
  it("impôt estimé : flat tax sur le seul compte-titres", () => {
    const base = a.gainRealise + a.dividendes + a.gainLatent!;
    expect(r.totaux.impotEstime).toBeCloseTo(base * 0.3, 6);
  });
});

describe("journal et portefeuille en base", () => {
  const db = getDb();
  const clean = () => { for (const t of [s.journal, s.portfolioTx, s.settings, s.prices, s.operations, s.change, s.actifsPerso, s.coursManuels]) db.delete(t).run(); };
  beforeEach(clean);
  afterAll(clean);
  it("transaction validée, symbole normalisé", () => {
    expect(() => addTx(db, { date: "2026-13-01", type: "achat", ticker: "AMD", quantite: 1, prix: 1, frais: 0, compte: "CTO" })).toThrow(/Date/);
    expect(() => addTx(db, { date: "2026-11-01", type: "achat", ticker: "AMD", quantite: 0, prix: 1, frais: 0, compte: "CTO" })).toThrow(/Quantité/);
    expect(addTx(db, { date: "2026-11-01", type: "achat", ticker: "brk-b", quantite: 1, prix: 500, frais: 0, compte: "CTO" }).ticker).toBe("BRK.B");
  });
  it("règles de risque et ETF de référence", () => {
    expect(setRegles(db, { poidsMax: 0.2 })).toMatchObject({ poidsMax: 0.2, baisseMax: 0.25, reference: "VT" });
    expect(() => setRegles(db, { reference: "XXX" })).toThrow();
    expect(getPortfolio(db, "2026-11-16").regles.poidsMax).toBe(0.2);
  });
  it("décision : contexte figé, performance depuis, revue à date, verdict face à l'ETF", () => {
    insertIgnore(db, s.prices, [
      { ticker: "AMD", date: "2026-10-01", open: 1, high: 1, low: 1, close: 100, volume: 1, closeBrut: 100 },
      { ticker: "AMD", date: "2026-11-13", open: 1, high: 1, low: 1, close: 130, volume: 1, closeBrut: 130 },
      { ticker: "VT", date: "2026-10-01", open: 1, high: 1, low: 1, close: 100, volume: 1, closeBrut: 100 },
      { ticker: "VT", date: "2026-11-13", open: 1, high: 1, low: 1, close: 105, volume: 1, closeBrut: 105 },
    ]);
    expect(() => addJournal(db, { ticker: "AMD", decision: "achat", these: " " }, "2026-10-01")).toThrow(/thèse/);
    const e = addJournal(db, { ticker: "AMD", decision: "achat", these: "Achats groupés d'initiés", prixDecision: 100, dateRevue: "2026-11-01", date: "2026-10-01" }, "2026-10-01");
    expect(JSON.parse(e.contexte!)).toHaveProperty("score");
    let j = listJournal(db, "2026-11-16");
    expect(j.entries[0]).toMatchObject({ aRevoir: true, verdictAuto: "bonne" });
    expect(j.entries[0].perf).toBeCloseTo(0.3, 9);
    expect(j.entries[0].perfRef).toBeCloseTo(0.05, 6);
    expect(j.stats).toMatchObject({ total: 1, aRevoir: 1, tauxAuto: 1 });
    reviewJournal(db, e.id, { resultat: "bonne", lecon: "Le signal des initiés a marché" });
    j = listJournal(db, "2026-11-16");
    expect(j.entries[0]).toMatchObject({ statut: "revue", aRevoir: false, lecon: "Le signal des initiés a marché" });
    expect(j.stats.bonnes).toBe(1);
  });
  it("portefeuille en euros : achats en euros, cours en dollars convertis au taux BCE du jour", () => {
    insertIgnore(db, s.change, [{ date: "2026-10-01", eurusd: 1.25 }, { date: "2026-11-13", eurusd: 1.1 }]);
    insertIgnore(db, s.prices, [
      { ticker: "NVDA", date: "2026-10-01", open: 1, high: 1, low: 1, close: 125, volume: 1, closeBrut: 125 },
      { ticker: "NVDA", date: "2026-11-13", open: 1, high: 1, low: 1, close: 132, volume: 1, closeBrut: 132 },
    ]);
    addTx(db, { date: "2026-10-01", type: "achat", ticker: "NVDA", quantite: 2, prix: 100, frais: 1, compte: "CTO", devise: "EUR" });
    const pf = getPortfolio(db, "2026-11-16");
    const n = pf.positions[0];
    expect(pf.devise).toBe("EUR");
    expect(n.pru).toBeCloseTo(100.5, 9);
    expect(n.cours).toBeCloseTo(120, 9); // 132 $ / 1,10
    expect(n.valeur).toBeCloseTo(240, 9);
    expect(n.gainLatentPct).toBeCloseTo(240 / 201 - 1, 9);
    expect(pf.cotes.NVDA).toMatchObject({ source: "marche", devise: "USD" });
    // Même portefeuille vu en dollars : l'achat de 201 € vaut 251,25 $ au taux du 1er octobre
    setRegles(db, { devise: "USD" });
    expect(getPortfolio(db, "2026-11-16").positions[0].pru).toBeCloseTo(125.625, 9);
  });
  it("sans taux de change : transaction signalée, jamais convertie au hasard", () => {
    addTx(db, { date: "2026-10-01", type: "achat", ticker: "NVDA", quantite: 1, prix: 100, frais: 0, compte: "CTO", devise: "USD" });
    const pf = getPortfolio(db, "2026-11-16");
    expect(pf.positions).toHaveLength(0);
    expect(pf.avertissements[0]).toMatch(/taux de change/);
  });
  it("actif à cours saisi, prolongé par un indice ; éligibilité PEA déclarée", () => {
    insertIgnore(db, s.change, [{ date: "2026-11-01", eurusd: 1.2 }, { date: "2026-11-13", eurusd: 1.2 }]);
    insertIgnore(db, s.prices, [
      { ticker: "SPY", date: "2026-11-02", open: 1, high: 1, low: 1, close: 600, volume: 1, closeBrut: 600 },
      { ticker: "SPY", date: "2026-11-13", open: 1, high: 1, low: 1, close: 630, volume: 1, closeBrut: 630 },
    ]);
    upsertActif(db, { ticker: "sp500eur", nom: "S&P 500 EUR (Acc)", devise: "EUR", cotation: "manuel", indice: "SPY", peaEligible: true });
    upsertActif(db, { ticker: "FDJ.PA", nom: "FDJ", devise: "EUR", cotation: "manuel" });
    addCoursManuel(db, { ticker: "SP500EUR", date: "2026-11-02", cours: 1000 });
    addCoursManuel(db, { ticker: "FDJ.PA", date: "2026-11-02", cours: 40 });
    addTx(db, { date: "2026-11-02", type: "achat", ticker: "SP500EUR", quantite: 1, prix: 1000, frais: 0, compte: "PEA", devise: "EUR" });
    addTx(db, { date: "2026-11-02", type: "achat", ticker: "FDJ.PA", quantite: 1, prix: 50, frais: 0, compte: "PEA", devise: "EUR" });
    const pf = getPortfolio(db, "2026-11-16");
    const etf = pf.positions.find((p) => p.ticker === "SP500EUR")!, fdj = pf.positions.find((p) => p.ticker === "FDJ.PA")!;
    expect(etf.cours).toBeCloseTo(1050, 9); // +5 % comme SPY (taux inchangé)
    expect(pf.cotes.SP500EUR).toMatchObject({ source: "indice", indice: "SPY", saisiLe: "2026-11-02" });
    expect(fdj.cours).toBe(40);
    expect(etf.alertes.join(" ")).not.toMatch(/PEA/);
    expect(fdj.alertes.join(" ")).toMatch(/Non déclaré éligible au PEA/);
    expect(pf.societes["FDJ.PA"]).toBe("FDJ");
    expect(() => addTx(db, { date: "2026-11-02", type: "achat", ticker: "X", quantite: 1, prix: 1, frais: 0, compte: "Livret" })).toThrow(/Compte/);
  });
  it("import depuis l'appli du courtier : quantité et prix d'entrée déduits, ligne en attente tant que le cours manque", () => {
    insertIgnore(db, s.change, [{ date: "2026-06-01", eurusd: 1.25 }]);
    const r = importLignes(db, [
      { ticker: "TTWO", compte: "CTO", valeur: 2000, gain: -100 },
      { ticker: "SP500EUR", nom: "S&P 500 EUR (Acc)", compte: "PEA", valeur: 973, gainPct: -0.027, cotation: "manuel", indice: "SPY", peaEligible: true },
    ], "2026-11-17");
    expect(r.map((x) => x.statut)).toEqual(["en attente", "importee"]);
    // Cours arrivé : 250 $ = 200 € le 16/11 ; 210 € (prix de revient) le 2 juillet
    insertIgnore(db, s.prices, [
      { ticker: "TTWO", date: "2026-06-30", open: 1, high: 1, low: 1, close: 240, volume: 1, closeBrut: 240 },
      { ticker: "TTWO", date: "2026-07-02", open: 1, high: 1, low: 1, close: 262.5, volume: 1, closeBrut: 262.5 },
      { ticker: "TTWO", date: "2026-11-16", open: 1, high: 1, low: 1, close: 250, volume: 1, closeBrut: 250 },
    ]);
    expect(processImports(db)[0]).toMatchObject({ ticker: "TTWO", statut: "importee" });
    const pf = getPortfolio(db, "2026-11-17");
    const t = pf.positions.find((p) => p.ticker === "TTWO")!, e = pf.positions.find((p) => p.ticker === "SP500EUR")!;
    expect(t.quantite).toBeCloseTo(10, 6);
    expect(t.pru).toBeCloseTo(210, 6);
    expect(t.valeur).toBeCloseTo(2000, 6);
    expect(pf.transactions.find((x) => x.ticker === "TTWO")!.date).toBe("2026-07-02");
    expect(e.pru).toBeCloseTo(1000, 6);
    expect(e.valeur).toBeCloseTo(973, 6);
    expect(pf.enAttente).toHaveLength(0);
    expect(processImports(db)).toEqual([]);
  });
  it("mes points d'entrée sur le graphique : prix payés et prix de revient convertis en dollars", () => {
    insertIgnore(db, s.change, [{ date: "2026-10-01", eurusd: 1.2 }, { date: "2026-11-13", eurusd: 1.1 }]);
    insertIgnore(db, s.prices, [{ ticker: "NVDA", date: "2026-11-13", open: 1, high: 1, low: 1, close: 150, volume: 1, closeBrut: 150 }]);
    addTx(db, { date: "2026-10-01", type: "achat", ticker: "NVDA", quantite: 2, prix: 100, frais: 0, compte: "CTO", devise: "EUR" });
    const m = mesEntrees(db, "NVDA", "2026-11-17")!;
    expect(m.transactions[0]).toMatchObject({ type: "achat", prix: 100, devise: "EUR" });
    expect(m.transactions[0].prixUsd).toBeCloseTo(120, 9); // 100 € au taux du 1er octobre
    expect(m.prixRevient).toBeCloseTo(100, 9);
    expect(m.prixRevientUsd).toBeCloseTo(110, 9); // seuil en dollars au dernier taux connu
    expect(mesEntrees(db, "AMD", "2026-11-17")).toBeNull();
  });
});
