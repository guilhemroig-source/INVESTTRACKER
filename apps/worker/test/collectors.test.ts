import { beforeEach, describe, expect, it, vi } from "vitest";
import { adaptArk, getDb, insertIgnore, insertOperations, schema as s, type TrumpTxJson } from "@tracker/core";

// Réponses HTTP simulées : aucun appel réseau pendant les tests.
const http = vi.hoisted(() => ({ getJson: vi.fn(), getText: vi.fn() }));
vi.mock("../src/http", async (orig) => ({ ...(await orig<typeof import("../src/http")>()), getJson: http.getJson, getText: http.getText }));

import { HttpError } from "../src/http";
import { reconcile, tradesFromDeltas } from "../src/collectors/ark";
import { collectPrix } from "../src/collectors/prix";
import { prevQuarterEnd } from "../src/collectors/thirteenf";
import { resolveUnverified } from "../src/collectors/trump";

const db = getDb();
const clear = () => { for (const t of [s.operations, s.rawArk, s.rawArkHoldings, s.prices, s.priceStatus, s.analyses, s.tickers]) db.delete(t).run(); };
beforeEach(() => { clear(); http.getJson.mockReset(); http.getText.mockReset(); });

describe("ARK : recoupement avec les positions publiées", () => {
  it("rattache le nombre exact d'actions à l'opération et en déduit le prix", () => {
    insertIgnore(db, s.rawArkHoldings, [
      { date: "2026-11-05", fonds: "ARKK", ticker: "TSLA", cusip: "x", actions: 1_800_000, valeurUsd: 6e8 },
      { date: "2026-11-06", fonds: "ARKK", ticker: "TSLA", cusip: "x", actions: 1_763_570, valeurUsd: 6.06e8 },
    ]);
    const r = adaptArk([{ date: "2026-11-05", fonds: "ARKK", operation: "Vente", ticker: "TSLA", montant_usd: 12_500_000, pct_position: 2, pct_etf: 0.2 }], new Map());
    insertIgnore(db, s.rawArk, r.raw); insertOperations(db, r.operations);
    expect(reconcile(db).n).toBe(1);
    expect(db.select().from(s.rawArk).get()!.actions).toBe(-36430);
    expect(db.select().from(s.operations).get()).toMatchObject({ volume: -36430, prix: 343.12 });
  });
  it("ne rattache pas une variation de sens contraire", () => {
    insertIgnore(db, s.rawArkHoldings, [
      { date: "2026-11-05", fonds: "ARKK", ticker: "AMD", cusip: "y", actions: 100, valeurUsd: 1 },
      { date: "2026-11-06", fonds: "ARKK", ticker: "AMD", cusip: "y", actions: 150, valeurUsd: 1 },
    ]);
    const r = adaptArk([{ date: "2026-11-05", fonds: "ARKK", operation: "Vente", ticker: "AMD", montant_usd: 1000, pct_position: 1, pct_etf: 0 }], new Map());
    insertIgnore(db, s.rawArk, r.raw);
    expect(reconcile(db).n).toBe(0);
  });
  it("secours : reconstitue les opérations depuis les positions (entrée, sortie), sans montant si aucun cours", () => {
    insertIgnore(db, s.rawArkHoldings, [
      { date: "2026-11-05", fonds: "ARKK", ticker: "OLD", cusip: "a", actions: 1000, valeurUsd: 10_000 },
      { date: "2026-11-06", fonds: "ARKK", ticker: "NEW", cusip: "b", actions: 500, valeurUsd: 5_000 },
    ]);
    const t = tradesFromDeltas(reconcile(db).deltas);
    expect(t.find((x) => x.ticker === "NEW")).toMatchObject({ date: "2026-11-05", operation: "Achat", actions: 500, montant_usd: 5000, origine: "ark-csv" });
    expect(t.find((x) => x.ticker === "OLD")).toMatchObject({ operation: "Vente", actions: -1000, montant_usd: null });
  });
});

describe("Cours (Tiingo)", () => {
  const op = (ticker: string, date: string) => insertOperations(db, [{ source: "ARK", categorie: "ARK", qui: "x", ticker, operation: "Achat", sens: "achat", dateOperation: date, datePublication: date, cleUnique: `k-${ticker}-${date}` }]);
  const bars = (n: number) => Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 5) * 10 + i * 0.1;
    return { date: new Date(Date.UTC(2025, 9, 1) + i * 86400_000).toISOString(), adjOpen: c, adjHigh: c + 1, adjLow: c - 1, adjClose: c, adjVolume: 1e6, close: c };
  });

  it("télécharge, stocke et analyse ; symbole inconnu noté ; quota atteint = arrêt propre", async () => {
    process.env.TIINGO_API_KEY = "test";
    process.env.TIINGO_MAX_PER_RUN = "10";
    op("AAA", "2026-03-02"); op("ZZZ", "2026-03-01"); op("QUO", "2026-02-28");
    http.getJson.mockImplementation(async (url: string) => {
      if (url.includes("/AAA/") || url.includes("/SPY/") || url.includes("/QQQ/")) return bars(400);
      if (url.includes("/ZZZ/")) throw new HttpError(url, 404, "inconnu");
      throw new HttpError(url, 429, "quota");
    });
    const r = await collectPrix(db);
    expect(http.getJson.mock.calls[0][1].headers).toEqual({ Authorization: "Token test" });
    // SPY et QQQ (références de marché) sont téléchargés en premier
    expect(db.select().from(s.prices).all().length).toBe(1200);
    expect(Object.fromEntries(db.select().from(s.priceStatus).all().map((x) => [x.ticker, x.statut]))).toEqual({ SPY: "ok", QQQ: "ok", AAA: "ok", ZZZ: "introuvable" });
    expect(r.details!.join(" ")).toContain("Quota Tiingo atteint");
    expect(db.select().from(s.analyses).get()).toMatchObject({ cleUnique: "k-AAA-2026-03-02", statut: "ok" });
  });

  it("une action déjà couverte n'est pas retéléchargée", async () => {
    process.env.TIINGO_API_KEY = "test";
    op("AAA", "2026-03-02");
    http.getJson.mockResolvedValue(bars(450));
    await collectPrix(db);
    http.getJson.mockClear();
    await collectPrix(db);
    // Les cours vont au-delà de l'opération + 100 jours : rien à demander
    expect(http.getJson).not.toHaveBeenCalled();
  });

  it("sans clé : erreur explicite", async () => {
    delete process.env.TIINGO_API_KEY;
    await expect(collectPrix(db)).rejects.toThrow(/TIINGO_API_KEY/);
  });
});

describe("13F et Trump", () => {
  it("trimestre précédent", () => {
    expect(["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"].map(prevQuarterEnd)).toEqual(["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]);
  });
  it("ligne « non vérifiée » rattachée seulement si le nom correspond à une seule société", () => {
    db.insert(s.tickers).values([{ ticker: "WHR", nom: "Whirlpool Corp" }, { ticker: "POOL", nom: "Pool Corp" }, { ticker: "AB", nom: "Acme Holdings" }, { ticker: "AC", nom: "Acme Holdings Inc" }]).run();
    const base = { operation: "Achat" as const, montant: "$1,001 - $15,000", montant_min: 1001, montant_max: 15000, date_transaction: "2026-08-28", depose_le: "2026-10-08" };
    const rows: TrumpTxJson[] = [
      { ...base, ticker: "POOL", nom_declare: "WHIRLPOOL CORP", non_verifie: true },
      { ...base, ticker: "XYZ", nom_declare: "ACME HOLDINGS", non_verifie: true }, // ambigu : 2 sociétés
      { ...base, ticker: "POOL", nom_declare: "POOL CORP", non_verifie: false },
    ];
    const r = resolveUnverified(db, rows);
    expect(r.rows.map((x) => x.ticker)).toEqual(["WHR", "XYZ", "POOL"]);
    expect(r.notes).toHaveLength(1);
  });
});
