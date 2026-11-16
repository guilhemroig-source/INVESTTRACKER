import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  adapt13F, adaptCongress, adaptForm4, adaptTrump, displayName, filingKey, form4Key, form4Sens, getCounts, getDb,
  importKit, next13FDeadline, quarterEnd, usFederalHolidays, schema as s, withOrdinal,
} from "../src";

const DATA = path.join(__dirname, "../../../data");
const db = getDb();
afterAll(() => { for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(`tracker-core-test-${process.pid}`)) fs.rmSync(path.join(os.tmpdir(), f)); });

describe("import du kit (data/)", () => {
  it("importe les 470 opérations, réparties par source", async () => {
    await importKit(db, DATA);
    expect(Object.fromEntries(getCounts(db).map((c) => [c.source, c.n]))).toEqual({ "13F": 98, ARK: 100, CONGRES: 50, FORM4: 72, TRUMP: 150 });
  });
  it("dédoublonnage strict : un second import n'ajoute rien", async () => {
    const res = await importKit(db, DATA) as Record<string, { ok: boolean; nouvelles: number }>;
    for (const [k, r] of Object.entries(res)) if (k !== "tickers") expect(r).toMatchObject({ ok: true, nouvelles: 0 });
    expect(db.select().from(s.operations).all()).toHaveLength(470);
  });
  it("journalise chaque source avec la date de la donnée la plus récente", () => {
    const log = db.select().from(s.collectLog).all();
    expect(log.find((l) => l.source === "import:ark")).toMatchObject({ statut: "ok", donneesAu: "2026-11-06" });
    expect(log.every((l) => l.statut === "ok")).toBe(true);
  });
  it("chaque opération a un nom de société quand il est connu", () => {
    const tsla = db.select().from(s.operations).all().filter((o) => o.ticker === "TSLA");
    expect(tsla.every((o) => o.societe === "Tesla")).toBe(true);
  });
});

describe("adaptateurs", () => {
  const names = new Map<string, string>();
  it("formulaire 4 : même clé pour la même ligne vue sur OpenInsider et sur EDGAR", () => {
    const a = { initie: "Musk Elon", date_operation: "2026-06-16", quantite: -17531857 };
    const b = { initie: "Elon  Musk", date_operation: "2026-06-16", quantite: -17531857 };
    expect(form4Key("TSLA", a)).toBe(form4Key("TSLA", b));
    expect(filingKey("TSLA", "Musk Elon", "2026-06-17")).toBe(filingKey("TSLA", "Elon Musk", "2026-06-17"));
  });
  it("formulaire 4 : sens, nom affiché, symbole unique", () => {
    expect(form4Sens({ quantite: -10, montant_usd: null, operation: "Vente" } as never)).toBe("vente");
    expect(form4Sens({ quantite: null, montant_usd: null, operation: "Attribution d'actions" } as never)).toBe("achat");
    expect(displayName("Musk Elon")).toBe("Elon Musk");
    expect(displayName("PLATINUM EQUITY, LLC")).toBe("Platinum Equity, LLC");
    const r = adaptForm4([{ depose_le: "2026-11-06", date_operation: "2026-11-05", ticker: "brk-b", initie: "Doe John", operation: "Achat", prix: 1, quantite: 5, montant_usd: 5 }], "gros", names);
    expect(r.operations[0]).toMatchObject({ ticker: "BRK.B", sens: "achat", montantUsd: 5, qui: "John Doe" });
  });
  it("13F : fin de trimestre, sens, pas de montant inventé", () => {
    expect(quarterEnd("T2 2026")).toBe("2026-06-30");
    expect(quarterEnd("T4 2025")).toBe("2025-12-31");
    const r = adapt13F([{ investisseur: "Warren Buffett", fonds: "Berkshire Hathaway", trimestre: "T2 2026", depose_le: "2026-08-14", ticker: "ALLY", operation: "Allègement", variation_actions: -2_000_000, variation_pct: -6.9 }], names);
    expect(r.operations[0]).toMatchObject({ sens: "vente", montantUsd: null, volume: -2_000_000, dateOperation: "2026-06-30" });
  });
  it("Trump / Congrès : lignes identiques gardées toutes, en multiensemble stable", () => {
    const row = { ticker: "MSFT", operation: "Achat" as const, montant: "$1,001 - $15,000", montant_min: 1001, montant_max: 15000, date_transaction: "2026-08-31", depose_le: "2026-10-08" };
    const keys = adaptTrump([row, row, row], names).operations.map((o) => o.cleUnique);
    expect(new Set(keys).size).toBe(3);
    expect(keys.map((k) => k.split("#")[1])).toEqual(["1", "2", "3"]);
    expect(withOrdinal(["a", "b", "a"], (x) => x).map((x) => x.key)).toEqual(["a#1", "b#1", "a#2"]);
    const c = adaptCongress([{ elu: "Pete Sessions", chambre: "Chambre", etat: "TX17", ticker: "MCD", operation: "Vente", montant: "$1,001 - $15,000", date_transaction: "2026-10-27", date_declaration: "2026-10-27", perf_pct: 1 }], names);
    expect(c.operations[0]).toMatchObject({ qui: "Pete Sessions (Chambre, TX17)", fourchette: "$1,001 - $15,000", montantUsd: null });
  });
});

describe("échéance légale des 13F", () => {
  it("45 jours après la fin du trimestre, reportée au jour ouvré suivant", () => {
    expect(next13FDeadline("2026-11-07")).toEqual({ trimestre: "T3 2026", limite: "2026-11-16" }); // 14 nov. = samedi
    // 14 fév. 2027 = dimanche, 15 = Presidents' Day (férié, SEC fermée) -> mardi 16
    expect(next13FDeadline("2026-11-17")).toEqual({ trimestre: "T4 2026", limite: "2027-02-16" });
    expect(next13FDeadline("2027-05-01")).toEqual({ trimestre: "T1 2027", limite: "2027-05-17" }); // 15 mai = samedi
  });
  it("jours fériés fédéraux", () => {
    const h = usFederalHolidays(2026);
    for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) expect(h.has(d), d).toBe(true);
    expect(h.size).toBe(11);
  });
});
