import { describe, expect, it } from "vitest";
import { type ClassementRow, cotationFrom, selectASuivre, selectPression } from "../src";

const row = (ticker: string, score: number, acheteurs: string[], vendeurs: string[], derniere = "2026-11-01"): ClassementRow => ({
  ticker, societe: null, score, acheteurs, vendeurs, initiesAchat: 0, derniere, retard: null, per: null, croissanceCa: null,
  margeNette: null, detteSurFp: null, volatilite: null, force6m: null, scoreDetail: [],
});

describe("aperçu", () => {
  it("variations 1 jour / 1 mois et courbe réduite", () => {
    const bars = Array.from({ length: 100 }, (_, i) => ({ date: `d${String(i).padStart(3, "0")}`, close: 100 + i }));
    const c = cotationFrom(bars, { cours: 210, date: "d099" });
    expect(c.cours).toBe(210); // cours réel affiché
    expect(c.var1j).toBeCloseTo(199 / 198 - 1);
    expect(c.var1m).toBeCloseTo(199 / 178 - 1);
    expect(c.spark.length).toBeLessThanOrEqual(43);
    expect(c.spark.at(-1)).toBe(199);
  });
  it("sans cours : rien d'inventé", () => {
    expect(cotationFrom([], null)).toEqual({ cours: null, date: null, var1j: null, var1m: null, spark: [] });
    expect(cotationFrom([{ date: "a", close: 5 }]).var1j).toBeNull();
  });
  it("à suivre : score positif et plus d'acheteurs que de vendeurs", () => {
    const rows = [row("A", 50, ["x", "y"], []), row("B", 40, ["x"], ["y", "z"]), row("C", 0, ["x"], []), row("D", 30, ["x"], [])];
    expect(selectASuivre(rows).map((r) => r.ticker)).toEqual(["A", "D"]);
  });
  it("sous pression : au moins deux vendeurs, triés par nombre de vendeurs", () => {
    const rows = [row("A", 0, [], ["x", "y"]), row("B", 0, ["x"], ["y", "z", "w"]), row("C", 0, [], ["x"]), row("D", 0, ["a", "b"], ["x", "y"])];
    expect(selectPression(rows).map((r) => r.ticker)).toEqual(["B", "A"]);
  });
});
