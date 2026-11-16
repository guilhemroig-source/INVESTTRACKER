import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type Bar, type OpLite, acteurOf, computeFundamentals, finances, isCompensation, risque, smartMoney, ttmAt } from "../src";

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "../../../fixtures", f), "utf8"));

describe("comptes XBRL (extrait réel d'AMD, SEC companyfacts)", () => {
  const f = computeFundamentals(fx("companyfacts-amd-extrait.json"))!;
  it("12 mois glissants au 26 sept. 2026 : chiffre d'affaires, bénéfice, BPA", () => {
    expect(f.arrete).toBe("2026-09-26");
    expect(f.revenuTtm).toBe(45_436_000_000);
    expect(f.revenuTtmPrec).toBe(32_027_000_000);
    expect(f.netTtm).toBe(7_619_000_000);
    expect(f.bpaTtm!).toBeCloseTo(4.61, 2);
  });
  it("bilan et nombre d'actions", () => {
    expect(f).toMatchObject({ tresorerie: 7_404_000_000, fondsPropres: 68_389_000_000, dette: 7_079_000_000, actions: 1_640_087_251 });
  });
  it("ratios : PER, croissance, trésorerie nette", () => {
    const r = finances(f, 534.06)!;
    expect(r.per!).toBeCloseTo(115.85, 1);
    expect(r.croissanceCa!).toBeCloseTo(0.4187, 3);
    expect(r.detteNette!).toBeLessThan(0);
    expect(r.lectures).toContain("Forte croissance du chiffre d'affaires (plus de 20 % sur un an).");
  });
  it("12 mois glissants = exercice + cumul en cours − cumul de l'an passé", () => {
    const facts = [
      { start: "2025-01-01", end: "2025-12-31", val: 100 },
      { start: "2025-01-01", end: "2025-06-30", val: 40 },
      { start: "2026-01-01", end: "2026-06-30", val: 60 },
    ];
    expect(ttmAt(facts, "2026-06-30")).toBe(120);
  });
});

describe("signaux des investisseurs", () => {
  const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
    const c = 100 * (1 + i * 0.002) + Math.sin(i) * 2;
    return { date: new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume: 1e6 };
  });
  const today = bars.at(-1)!.date;
  const d = (k: number) => bars[bars.length - 1 - k].date;
  const op = (o: Partial<OpLite>): OpLite => ({ source: "FORM4", sens: "achat", qui: "X", operation: "Achat", datePublication: d(5), dateOperation: d(6), montantUsd: 1e6, ...o });

  it("nom d'acteur commun, ventes de rémunération à part", () => {
    expect(acteurOf({ source: "ARK", qui: "Cathie Wood (ARK · ARKW)" })).toBe("Cathie Wood (ARK)");
    expect(isCompensation({ source: "FORM4", operation: "Vente (après exercice d'options)" })).toBe(true);
    expect(isCompensation({ source: "FORM4", operation: "Vente" })).toBe(false);
  });
  it("achats groupés d'initiés, nouvelle position de fonds, vendeurs : score et détail", () => {
    const ops = [
      op({ qui: "Jane CEO (CEO)" }), op({ qui: "John CFO (CFO)", dateOperation: d(10) }),
      op({ source: "13F", qui: "Warren Buffett (Berkshire Hathaway)", operation: "Nouvelle position", trimestre: "T3 2026", poidsPct: 3.2, rang: 8 }),
      op({ sens: "vente", qui: "Bob Dir (Dir)", operation: "Vente" }),
      op({ sens: "vente", qui: "Al VP (VP)", operation: "Vente (après exercice d'options)" }),
      op({ source: "TRUMP", qui: "Donald Trump (Président)" }),
    ];
    const s = smartMoney(ops, bars, today, new Map());
    expect(s.acheteurs.map((a) => a.acteur).sort()).toEqual(["Donald Trump", "Jane CEO", "John CFO", "Warren Buffett"]);
    expect(s.vendeurs.map((a) => a.acteur)).toEqual(["Bob Dir"]);
    expect(s.ventesTechniques).toBe(1);
    expect(s.achatsInities).toMatchObject({ n: 2, groupe: true });
    // 15 + 15 + 15 + 5 plafonné à 45, +20 groupés, +10 nouvelle position, +10 top 10, −10 vendeur
    expect(s.score).toBe(75);
    expect(s.fonds[0]).toMatchObject({ poidsPct: 3.2, rang: 8 });
    expect(s.retard.details.length).toBe(4);
  });
  it("risque : volatilité, bêta, pire baisse, liquidité", () => {
    const r = risque(bars, bars, bars);
    expect(r.beta!).toBeCloseTo(1, 5);
    expect(r.force6m!).toBeCloseTo(0, 5);
    expect(r.volatilite!).toBeGreaterThan(0);
    expect(r.pireBaisse!).toBeLessThanOrEqual(0);
    expect(r.liquiditeUsd!).toBeGreaterThan(0);
  });
});
