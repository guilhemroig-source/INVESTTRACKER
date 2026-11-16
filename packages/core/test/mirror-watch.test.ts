import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Bar, type MirrorOp, addWatch, getDb, insertOperations, listWatch, matches, mirrorFor, removeWatch, schema as s, watchFeed, watchMatches } from "../src";

const day = (i: number) => new Date(Date.UTC(2026, 0, 5) + i * 86400_000).toISOString().slice(0, 10);
const mk = (f: (i: number) => number): Bar[] => Array.from({ length: 200 }, (_, i) => ({ date: day(i), open: f(i), high: f(i), low: f(i), close: f(i), volume: 1e6 }));

describe("portefeuille miroir", () => {
  const up = mk((i) => 100 + i); // +1 $ par séance
  const flat = mk(() => 100);
  const bars = (t: string) => (t === "UP" ? up : t === "FLAT" ? flat : []);
  const op = (o: Partial<MirrorOp>): MirrorOp => ({ ticker: "UP", source: "13F", sens: "achat", qui: "Warren Buffett (Berkshire Hathaway)", operation: "Nouvelle position", datePublication: day(10), dateOperation: day(5), montantUsd: null, ...o });

  it("achète à la clôture de la séance qui suit la publication, revend à la publication de la vente", () => {
    const ops = [op({}), op({ sens: "vente", operation: "Sortie totale", datePublication: day(50), dateOperation: day(45) })];
    const r = mirrorFor("Warren Buffett", ops, bars, flat);
    expect(r.couverts).toBe(1);
    expect(r.trades[0]).toMatchObject({ entree: { date: day(11), prix: 111 }, sortie: { date: day(51), prix: 151, raison: "vente" } });
    expect(r.trades[0].perf).toBeCloseTo(40 / 111, 6);
    expect(r.trades[0].perfSpy).toBe(0);
    expect(r.trades[0].excedent).toBeCloseTo(40 / 111, 6);
  });
  it("position gardée jusqu'au dernier cours sans vente ; coût du délai de publication", () => {
    const r = mirrorFor("Jane Doe", [op({ source: "FORM4", qui: "Jane Doe (CEO)", operation: "Achat", trimestre: null })], bars, flat);
    expect(r.trades[0].sortie).toMatchObject({ raison: "en cours", date: day(199) });
    // Acheter au jour de l'opération (cours 105) plutôt qu'après publication (111)
    expect(r.trades[0].perfSansRetard).toBeCloseTo(299 / 105 - 1, 6);
    expect(r.coutRetard!).toBeGreaterThan(0);
  });
  it("ignore les ventes de rémunération et les actions sans cours", () => {
    const r = mirrorFor("Jane Doe", [
      op({ source: "FORM4", qui: "Jane Doe (CEO)", operation: "Achat", ticker: "NOPE" }),
      op({ source: "FORM4", qui: "Jane Doe (CEO)", operation: "Achat" }),
      op({ source: "FORM4", qui: "Jane Doe (CEO)", sens: "vente", operation: "Vente (après exercice d'options)", datePublication: day(20) }),
    ], bars, flat);
    expect(r.signaux).toBe(2);
    expect(r.couverts).toBe(1);
    expect(r.trades[0].sortie.raison).toBe("en cours");
  });
  it("portefeuille : 1 000 $ par achat, comparé au S&P 500", () => {
    const r = mirrorFor("Warren Buffett", [op({}), op({ ticker: "FLAT" })], bars, up, { courbe: true });
    expect(r.portefeuille!.investi).toBe(2000);
    expect(r.portefeuille!.gainPct).toBeCloseTo(((299 / 111 - 1) + 0) / 2, 6);
    expect(r.courbe.length).toBeGreaterThan(10);
  });
});

describe("liste de suivi", () => {
  const db = getDb();
  // La base de test est partagée entre fichiers : on la laisse vide
  afterAll(() => { db.delete(s.watchlist).run(); db.delete(s.operations).run(); });
  beforeEach(() => { db.delete(s.watchlist).run(); db.delete(s.operations).run(); });
  const ins = (o: Partial<typeof s.operations.$inferInsert>) => insertOperations(db, [{ source: "FORM4", categorie: "x", qui: "Jane Doe (CEO)", ticker: "NVDA", operation: "Achat", sens: "achat", datePublication: "2026-11-14", cleUnique: Math.random().toString(36), ...o }]);

  it("règles : action (symbole normalisé), investisseur, score ; pas de doublon", () => {
    addWatch(db, { type: "action", valeur: "brk-b" });
    addWatch(db, { type: "action", valeur: "BRK.B" });
    addWatch(db, { type: "investisseur", valeur: "Stanley Druckenmiller", sens: "achat" });
    expect(listWatch(db).map((r) => r.valeur).sort()).toEqual(["BRK.B", "Stanley Druckenmiller"]);
    expect(() => addWatch(db, { type: "score", valeur: "250" })).toThrow();
    removeWatch(db, listWatch(db)[0].id);
    expect(listWatch(db)).toHaveLength(1);
  });
  it("correspondances : sens respecté, ventes de rémunération ignorées pour un investisseur", () => {
    const inv = addWatch(db, { type: "investisseur", valeur: "Jane Doe" });
    const act = addWatch(db, { type: "action", valeur: "NVDA", sens: "vente" });
    const op = (o: Partial<typeof s.operations.$inferSelect>) => ({ source: "FORM4", qui: "Jane Doe (CEO)", ticker: "NVDA", operation: "Achat", sens: "achat", ...o }) as typeof s.operations.$inferSelect;
    expect(matches(inv, op({}))).toBe(true);
    expect(matches(inv, op({ sens: "vente", operation: "Vente (après exercice d'options)" }))).toBe(false);
    expect(matches(act, op({}))).toBe(false);
    expect(matches(act, op({ sens: "vente", operation: "Vente" }))).toBe(true);
  });
  it("nouveautés depuis le dernier passage et fil de la liste", () => {
    addWatch(db, { type: "action", valeur: "NVDA" });
    ins({ creeLe: "2026-11-10T00:00:00Z" });
    ins({ ticker: "AMD", creeLe: "2026-11-16T10:00:00Z" });
    ins({ creeLe: "2026-11-16T10:00:00Z", qui: "Bob Smith (Dir)" });
    const m = watchMatches(db, "2026-11-15T00:00:00Z", "2026-11-16");
    expect(m).toHaveLength(1);
    expect(m[0].texte).toBe("Bob Smith Achat NVDA (publie 14/11)");
    expect(watchFeed(db).map((o) => o.ticker)).toEqual(["NVDA", "NVDA"]);
  });
});
