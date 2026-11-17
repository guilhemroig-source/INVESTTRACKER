import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getCalendrier, getDb, insertIgnore, schema as s } from "../src";

const db = getDb();
const clean = () => { for (const t of [s.evenements, s.operations, s.portfolioTx, s.watchlist]) db.delete(t).run(); };
beforeEach(clean);
afterAll(clean);
const ev = (cle: string, date: string, ticker: string, type = "resultats") =>
  ({ cle, date, heure: "amc", ticker, type, titre: "Résultats T3 (exercice 2027)", details: JSON.stringify({ bpaEstime: 2.5 }), source: "Finnhub", url: null, collecteLe: "2026-11-17T00:00:00Z" });
const op = (ticker: string, sens: "achat" | "vente", qui: string) => ({
  cleUnique: `${ticker}${sens}${qui}`, source: "13F", categorie: "fonds", qui, ticker, societe: null, sens, operation: sens === "achat" ? "Achat" : "Vente",
  montantUsd: 1, volume: null, fourchette: null, dateOperation: "2026-10-01", datePublication: "2026-11-01", lien: null,
});

describe("calendrier", () => {
  it("garde mes actions et celles des investisseurs, avec acheteurs et vendeurs", () => {
    insertIgnore(db, s.operations, [op("NVDA", "achat", "Berkshire Hathaway"), op("NVDA", "vente", "Pershing Square")] as never);
    db.insert(s.portfolioTx).values({ date: "2026-10-01", type: "achat", ticker: "TTWO", quantite: 1, prix: 200, frais: 0, compte: "CTO", devise: "USD" }).run();
    insertIgnore(db, s.evenements, [ev("a", "2026-11-17", "NVDA"), ev("b", "2026-11-18", "TTWO"), ev("c", "2026-11-18", "ZZZZ"), ev("d", "2026-11-12", "TTWO", "nouvelle")]);
    const c = getCalendrier(db, "2026-11-17");
    const t = c.evenements.filter((e) => e.ticker).map((e) => e.ticker);
    expect(t).toEqual(["TTWO", "NVDA", "TTWO"]); // ZZZZ (personne ne la suit) écartée ; tri par date
    const n = c.evenements.find((e) => e.ticker === "NVDA")!;
    expect(n).toMatchObject({ mien: false, acheteurs: ["Berkshire Hathaway"], vendeurs: ["Pershing Square"], passe: false, details: { bpaEstime: 2.5 } });
    const tt = c.evenements.find((e) => e.ticker === "TTWO" && e.date === "2026-11-18")!;
    expect(tt).toMatchObject({ mien: true, detenu: true });
    expect(c.evenements.find((e) => e.date === "2026-11-12")!.passe).toBe(true);
    expect(c.resultatsCollectes).toBe(true);
  });
  it("Fed et échéance des 13F dans la fenêtre", () => {
    const c = getCalendrier(db, "2026-11-17");
    expect(c.evenements.find((e) => e.type === "macro")).toMatchObject({ date: "2026-12-09", heure: "20:00" });
    // 13F du T3 : le 14 nov. tombe un samedi, reporté au lundi 16 (dans la fenêtre J−7, donc passé)
    expect(c.evenements.find((e) => e.type === "echeance")).toMatchObject({ date: "2026-11-16", passe: true });
    expect(c.resultatsCollectes).toBe(false);
  });
});
