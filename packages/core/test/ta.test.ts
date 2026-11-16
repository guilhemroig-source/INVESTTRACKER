import { describe, expect, it } from "vitest";
import { type Bar, analyzeTrade, bollinger, clusterLevels, ema, macd, motifOf, rsi, sma, stochastic } from "../src";

/** Série synthétique : cours journaliers à partir d'une liste de clôtures. */
const barsFrom = (closes: number[], volume = (i: number) => 1_000_000): Bar[] =>
  closes.map((c, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: volume(i) }));

describe("indicateurs", () => {
  it("moyennes mobiles", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([1, 2, 3, 4, 5], 3).map((x) => x && Math.round(x * 100) / 100)).toEqual([null, null, 2, 3, 4]);
  });
  it("RSI : 100 en hausse continue, 0 en baisse continue, ~50 en alternance", () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)).at(-1)).toBe(100);
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 - i)).at(-1)).toBe(0);
    { const v = rsi(Array.from({ length: 60 }, (_, i) => 100 + (i % 2))).at(-1)!; expect(Math.abs(v - 50)).toBeLessThan(5); }
  });
  it("RSI de référence (exemple de Wilder, 14 jours)", () => {
    // Série classique du livre de Wilder : RSI(14) ≈ 70,46 sur la 15e valeur.
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(c)[14]!).toBeCloseTo(70.46, 1);
  });
  it("MACD positif en tendance haussière", () => {
    const m = macd(Array.from({ length: 80 }, (_, i) => 100 + i));
    expect(m.line.at(-1)!).toBeGreaterThan(0);
    expect(m.signal.at(-1)).not.toBeNull();
  });
  it("Bollinger : %B > 1 après un saut au-dessus des bandes", () => {
    const b = bollinger([...Array(25).fill(100).map((x, i) => x + (i % 2)), 120]);
    expect(b.pctB.at(-1)!).toBeGreaterThan(1);
  });
  it("stochastique en haut de la fourchette après une hausse", () => {
    const st = stochastic(barsFrom(Array.from({ length: 30 }, (_, i) => 100 + i)));
    expect(st.k.at(-1)!).toBeGreaterThan(80);
  });
  it("regroupe les niveaux proches", () => {
    expect(clusterLevels([100, 101, 150, 99.5])).toEqual([{ price: expect.closeTo(100.17, 1), touches: 3 }, { price: 150, touches: 1 }]);
  });
});

describe("analyse d'une opération", () => {
  // 200 séances de hausse régulière puis 15 séances de forte baisse : survente.
  const closes = [...Array.from({ length: 200 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 15 }, (_, i) => 200 - (i + 1) * 4), ...Array.from({ length: 30 }, (_, i) => 140 + i)];
  const bars = barsFrom(closes);
  const date = bars[214].date;

  it("un achat en survente : RSI, Bollinger et stochastique pour l'achat", () => {
    const a = analyzeTrade(bars, { source: "ARK", sens: "achat", operation: "Achat", dateOperation: date, datePublication: date });
    expect(a.statut).toBe("ok");
    expect(a.readings).toHaveLength(8);
    const by = Object.fromEntries(a.readings.map((r) => [r.id, r.accord]));
    expect(by.rsi).toBe("pour");
    expect(by.bollinger).toBe("pour");
    expect(by.stoch).toBe("pour");
    expect(a.pour + a.contre + a.neutres).toBe(8);
  });
  it("la même situation lue pour une vente : les mêmes signaux sont « contre »", () => {
    const a = analyzeTrade(bars, { source: "ARK", sens: "vente", operation: "Vente", dateOperation: date, datePublication: date });
    expect(Object.fromEntries(a.readings.map((r) => [r.id, r.accord])).rsi).toBe("contre");
  });
  it("mesure la suite (5, 20 séances)", () => {
    const a = analyzeTrade(bars, { source: "ARK", sens: "achat", operation: "Achat", dateOperation: date, datePublication: date });
    expect(a.suite.map((x) => x.jours)).toEqual([5, 20]);
    expect(a.suite[0].perf).toBeGreaterThan(0);
  });
  it("13F : calcul au dernier jour du trimestre, variation sur le trimestre", () => {
    const q = barsFrom(Array.from({ length: 300 }, (_, i) => 100 + i));
    const a = analyzeTrade(q, { source: "13F", sens: "achat", operation: "Renforcement", dateOperation: "2026-06-30", datePublication: "2026-08-14", trimestre: "T2 2026" });
    expect(a.refDate).toBe("2026-06-30");
    expect(a.periode?.debut).toBe("2026-04-01");
  });
  it("historique trop court : pas d'analyse inventée", () => {
    const a = analyzeTrade(barsFrom([1, 2, 3]), { source: "ARK", sens: "achat", operation: "Achat", dateOperation: "2026-01-03", datePublication: "2026-01-03" });
    expect(a.statut).toBe("insuffisant");
    expect(a.readings).toHaveLength(0);
  });
  it("motif hors graphique selon le type d'opération", () => {
    expect(motifOf({ source: "FORM4", sens: "vente", operation: "Vente (après exercice d'options)", dateOperation: null, datePublication: "x" }).titre).toBe("Vente liée à la rémunération");
    expect(motifOf({ source: "FORM4", sens: "achat", operation: "Achat", dateOperation: null, datePublication: "x" }).titre).toBe("Achat sur le marché par un initié");
  });
});
