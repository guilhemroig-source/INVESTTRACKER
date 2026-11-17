import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateForm4, parseArkHoldingsCsv, parseCathiesArkTrades, parseCompactUsd, parseDate, parseForm4Xml,
  parseOpenInsiderTable, personKey, form4Key, issuerIndex, tickerFromIssuer, trimestreOf,
} from "../src";

const fx = (f: string) => fs.readFileSync(path.join(__dirname, "../../../fixtures", f), "utf8");

describe("formulaire 4 — Musk / Tesla, 17 juin 2026 (fixture réelle EDGAR)", () => {
  const doc = parseForm4Xml(fx("form4-musk-tesla-2026-06-17.xml"));
  it("lit l'émetteur et le déclarant", () => {
    expect(doc.ticker).toBe("TSLA");
    expect(doc.issuerCik).toBe("0001318605");
    expect(doc.owners[0]).toMatchObject({ cik: "0001494730", name: "Musk Elon" });
    expect(doc.owners[0].roles).toContain("10%");
  });
  it("lit les tables non dérivée et dérivée", () => {
    expect(doc.transactions.filter((t) => t.table === "nonDerivative").map((t) => t.code)).toEqual(["M", "F"]);
    expect(doc.transactions.filter((t) => t.table === "derivative").map((t) => t.code)).toEqual(["M"]);
  });
  it("donne les lignes du kit : exercice de 303 960 630 options à 23,34 $ et retenue de 17 531 857 actions", () => {
    const lines = aggregateForm4(doc);
    expect(lines).toEqual([
      expect.objectContaining({ date: "2026-06-16", code: "M", quantite: 303960630, prix: 23.34, montantUsd: 7094441104 }),
      expect.objectContaining({ date: "2026-06-16", code: "F", quantite: -17531857, prix: 404.66, montantUsd: -7094441254 }),
    ]);
  });
});

describe("formulaire 4 — Musk / SpaceX (fixture réelle EDGAR)", () => {
  const doc = parseForm4Xml(fx("form4-musk-spacex.xml"));
  const lines = aggregateForm4(doc);
  it("lit le symbole SPCX et les 19 transactions", () => {
    expect(doc.ticker).toBe("SPCX");
    expect(doc.transactions).toHaveLength(19);
  });
  it("regroupe par date et code : vente de 11 390 actions à 105,318 $", () => {
    expect(lines.find((l) => l.code === "S")).toMatchObject({ date: "2026-04-02", quantite: -11390, prix: 105.318, montantUsd: -1199572 });
  });
  it("conversion des actions de préférence : +315 926 250 actions A", () => {
    expect(lines.find((l) => l.code === "C")).toMatchObject({ date: "2026-06-15", quantite: 315926250, montantUsd: null });
  });
  it("pas de montant pour une attribution, un don ou une annulation", () => {
    for (const c of ["A", "G", "D"]) expect(lines.find((l) => l.code === c)?.montantUsd).toBeNull();
  });
  it("lit les notes de bas de page", () => {
    expect(Object.keys(doc.footnotes).length).toBeGreaterThan(0);
  });
});

describe("ARK", () => {
  it("lit le tableau cathiesark (fixture réelle du 7 nov. 2026)", () => {
    const rows = parseCathiesArkTrades(fx("cathiesark-trades-2026-11-07.html"));
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({ date: "2026-11-06", fonds: "ARKW", ticker: "BLSH", operation: "Vente", montant_usd: 935500, pct_position: 7.15, pct_etf: 0.06 });
    expect(new Set(rows.map((r) => r.fonds))).toEqual(new Set(["ARKK", "ARKW", "ARKG", "ARKQ", "ARKF", "ARKX"]));
  });
  it("lit le CSV des positions ARKK (fixture réelle)", () => {
    const rows = parseArkHoldingsCsv(fx("ark-holdings-arkk-2026-11-06.csv"));
    expect(rows[0]).toMatchObject({ date: "2026-11-06", fonds: "ARKK", ticker: "TSLA", cusip: "88160R101", actions: 1763570, valeur_usd: 606121373.3, poids_pct: 10.74 });
    expect(rows.every((r) => r.fonds === "ARKK")).toBe(true);
  });
});

describe("OpenInsider (fixture synthétique, voir l'en-tête du fichier)", () => {
  const rows = parseOpenInsiderTable(fx("openinsider-latest.SYNTHETIQUE.html"));
  it("repère les colonnes par leur en-tête", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      depose_le: "2026-11-06", heure_depot: "06:00", date_operation: "2026-11-04", ticker: "SE", societe: "Sea Ltd",
      initie: "Zhao Feng", insider_cik: "1712345", fonction: "Pres of Garena", operation: "Vente",
      prix: 80.22, quantite: -30000, montant_usd: -2406600,
    });
    expect(rows[0].sec_url).toMatch(/^https:\/\/www\.sec\.gov\/Archives/);
  });
  it("traduit S+OE et P", () => {
    expect(rows[1].operation).toBe("Vente (après exercice d'options)");
    expect(rows[2]).toMatchObject({ operation: "Achat", quantite: 208971, montant_usd: 2089710 });
  });
  it("laisse les autres types tels quels (filtrés par le collecteur)", () => {
    expect(rows[3].type).toBe("A - Grant");
  });
});

describe("utilitaires", () => {
  it("montants compacts", () => {
    expect(parseCompactUsd("$42.3K")).toBe(42300);
    expect(parseCompactUsd("$1.70M")).toBe(1700000);
    expect(parseCompactUsd("-$2.1B")).toBe(-2100000000);
  });
  it("dates", () => {
    expect(parseDate("Nov 06, 2026")).toBe("2026-11-06");
    expect(parseDate("11/06/2026")).toBe("2026-11-06");
    expect(parseDate("2026-11-06 06:00:12")).toBe("2026-11-06");
  });
  it("même clé pour « Musk Elon » (SEC) et « Elon Musk »", () => {
    expect(personKey("Musk Elon")).toBe(personKey("Elon  Musk"));
    expect(form4Key("TSLA", { initie: "Musk Elon", date_operation: "2026-06-16", quantite: 1 }))
      .toBe(form4Key("TSLA", { initie: "Elon Musk", date_operation: "2026-06-16", quantite: 1 }));
  });
});

import { bargoTradesToJson, canonTicker, diff13F, filingPeriod, parseGetSignalTrump, parseInfoTable, parseInsidersetActivity, parseInsidersetInvestor, parseOpenCabinetTrump } from "../src";

describe("13F — information table Berkshire T2 2026 (fixture réelle EDGAR)", () => {
  const h = parseInfoTable(fx("13f-berkshire-t2-2026.xml"));
  it("additionne les lignes d'un même CUSIP (plusieurs gérants)", () => {
    expect(h.find((x) => x.cusip === "02005N100")).toMatchObject({ nameOfIssuer: "ALLY FINL INC", shares: 27000000 });
  });
  it("29 lignes distinctes", () => expect(h).toHaveLength(29));
  it("calcule les mouvements entre deux trimestres", () => {
    const prev = [{ cusip: "A", nameOfIssuer: "A", titleOfClass: "", shares: 100, value: 0 }, { cusip: "B", nameOfIssuer: "B", titleOfClass: "", shares: 50, value: 0 }, { cusip: "C", nameOfIssuer: "C", titleOfClass: "", shares: 10, value: 0 }];
    const cur = [{ cusip: "A", nameOfIssuer: "A", titleOfClass: "", shares: 150, value: 0 }, { cusip: "B", nameOfIssuer: "B", titleOfClass: "", shares: 20, value: 0 }, { cusip: "D", nameOfIssuer: "D", titleOfClass: "", shares: 5, value: 0 }];
    const m = Object.fromEntries(diff13F(prev, cur).map((x) => [x.cusip, [x.operation, x.variation, x.variation_pct]]));
    expect(m).toEqual({ A: ["Renforcement", 50, 50], B: ["Allègement", -30, -60], C: ["Sortie totale", -10, -100], D: ["Nouvelle position", 5, null] });
  });
});

describe("insiderset (fixtures réelles)", () => {
  it("lit toutes les lignes, y compris celles de la page 2 (JSON embarqué)", () => {
    const rows = parseInsidersetActivity(fx("insiderset-tepper-q2-2026.html"));
    expect(rows).toHaveLength(32);
    expect(rows[0]).toMatchObject({ ticker: "AAL", trimestre: "T2 2026", operation: "Nouvelle position", variation_actions: 7500000 });
    expect(rows.find((r) => r.ticker === "AMD")).toMatchObject({ operation: "Allègement", variation_actions: -23900, variation_pct: -10.8 });
  });
  it("lit le dernier trimestre et sa date de publication", () => {
    expect(parseInsidersetInvestor(fx("insiderset-investor-buffett.html"))).toEqual({ trimestre: "T2 2026", quarter: "Q2 2026", depose_le: "2026-08-14" });
  });
});

describe("Trump (fixtures réelles getsignal / open-cabinet)", () => {
  const g = parseGetSignalTrump(fx("getsignal-trump-2026-11-07.html"));
  it("statistiques", () => {
    expect(g.meta).toEqual({ a_jour_au: "2026-11-06", delai_median_jours: 60, part_hors_delai_45j: 0.861, premiere_transaction: "2026-01-02", derniere_transaction: "2026-08-31" });
  });
  it("5 déclarations, 7 514 transactions", () => {
    expect(g.filings).toHaveLength(5);
    expect(g.filings.reduce((a, f) => a + f.transactions, 0)).toBe(7514);
    expect(g.filings[0]).toMatchObject({ periode: "T1 2026", achats: 2346, ventes: 1294 });
  });
  it("150 dernières transactions, lignes « non vérifiées » comprises", () => {
    expect(g.recent).toHaveLength(150);
    expect(g.recent.find((r) => r.nom_declare === "WHIRLPOOL CORP")).toMatchObject({ ticker: "POOL", non_verifie: true });
    expect(g.recent.find((r) => r.ticker === "VGNT")).toMatchObject({ non_verifie: true });
  });
  it("top des actions", () => expect(g.topTickers.slice(0, 2)).toEqual([{ ticker: "MSFT", transactions: 48 }, { ticker: "META", transactions: 45 }]));
  it("open-cabinet : dernière déclaration", () => {
    expect(parseOpenCabinetTrump(fx("opencabinet-trump-2026-11-07.html"))).toEqual({ derniere_declaration: "2026-10-08", transactions: 517 });
  });
  it("libellé de période", () => {
    expect(filingPeriod("2026-01-02", "2026-03-30")).toBe("T1 2026");
    expect(filingPeriod("2026-08-03", "2026-08-31")).toBe("Août 2026");
  });
});

describe("Congrès (fixture réelle Bargo)", () => {
  it("convertit au format du kit", () => {
    const rows = bargoTradesToJson(JSON.parse(fx("bargo-trades-2026-11-07.json")).trades);
    expect(rows).toHaveLength(50);
    expect(rows[0]).toMatchObject({ elu: "Pete Sessions", chambre: "Chambre", etat: "TX17", ticker: "MCD", operation: "Vente", montant: "$1,001 - $15,000", perf_pct: 10.84 });
  });
  it("symboles : une seule forme", () => {
    expect(canonTicker("BRK-B")).toBe("BRK.B");
    expect(canonTicker("len.b")).toBe("LEN.B");
  });
});

describe("getsignal : nouvelle mise en page (novembre 2026)", () => {
  it("statistiques, déclarations, transactions et actions les plus traitées", () => {
    const r = parseGetSignalTrump(fx("getsignal-trump-2026-11-17.html"));
    expect(r.meta).toEqual({ a_jour_au: "2026-11-16", delai_median_jours: 60, part_hors_delai_45j: 0.861, premiere_transaction: "2026-01-02", derniere_transaction: "2026-08-31" });
    expect(r.filings).toHaveLength(5);
    expect(r.filings.at(-1)).toMatchObject({ depose_le: "2026-10-08", transactions: 517, achats: 289, ventes: 228 });
    expect(r.recent).toHaveLength(150);
    expect(r.topTickers).toHaveLength(25);
    expect(r.topTickers[0]).toEqual({ ticker: "MSFT", transactions: 48 });
    expect(r.topTickers.find((t) => t.ticker === "BRK.B")?.transactions).toBe(28);
  });
});

describe("13F : rapprochement des émetteurs par le nom", () => {
  const idx = issuerIndex([
    { ticker: "ORCL", nom: "Oracle", cik: "1" }, { ticker: "ORCL.PD", nom: "Oracle Corp", cik: "1" },
    { ticker: "AMAT", nom: "Applied Materials", cik: "2" }, { ticker: "ET", nom: "Energy Transfer LP", cik: "3" },
    { ticker: "GOOG", nom: "Alphabet (Google)", cik: "4" }, { ticker: "GOOGL", nom: "Alphabet (A)", cik: "4" },
    { ticker: "ABC", nom: "Homonyme Inc", cik: "5" }, { ticker: "XYZ", nom: "Homonyme Corp", cik: "6" },
    { ticker: "VRSN", nom: "Verisign Inc/Ca", cik: "7" },
  ]);
  it("abréviations de la SEC et actions de préférence écartées", () => {
    expect(tickerFromIssuer("ORACLE CORP", idx, "COM")).toBe("ORCL");
    expect(tickerFromIssuer("APPLIED MATLS INC", idx, "COM")).toBe("AMAT");
    expect(tickerFromIssuer("ENERGY TRANSFER L P", idx, "COM UT LTD PTN")).toBe("ET");
    expect(tickerFromIssuer("VERISIGN INC", idx, "COM")).toBe("VRSN");
  });
  it("jamais de devinette : catégories d'actions ou sociétés différentes", () => {
    expect(tickerFromIssuer("ALPHABET INC", idx, "CAP STK CL A")).toBeNull();
    expect(tickerFromIssuer("HOMONYME", idx, "COM")).toBeNull();
    expect(tickerFromIssuer("INCONNUE SA", idx, "COM")).toBeNull();
  });
  it("trimestre d'une date de fin", () => {
    expect(trimestreOf("2026-09-30")).toBe("T3 2026");
    expect(trimestreOf("2025-12-31")).toBe("T4 2025");
  });
});
