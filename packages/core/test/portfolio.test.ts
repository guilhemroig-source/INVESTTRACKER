import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Bar, type PortfolioTx, addJournal, addTx, computePortfolio, getDb, getPortfolio, insertIgnore, listJournal, reviewJournal, schema as s, setRegles } from "../src";

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
    expect(b.alertes.join(" ")).toMatch(/non éligible au PEA/);
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
  const clean = () => { for (const t of [s.journal, s.portfolioTx, s.settings, s.prices, s.operations]) db.delete(t).run(); };
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
});
