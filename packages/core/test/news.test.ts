import { describe, expect, it } from "vitest";
import { type Bar, classify, classify8K, companyAliases, explainWithNews, mentions, shortName } from "../src";

describe("classement des nouvelles", () => {
  it("thèmes et tonalité à partir du titre", () => {
    expect(classify("AMD beats estimates, raises guidance")).toMatchObject({ themes: expect.arrayContaining(["resultats", "previsions"]), ton: 1 });
    expect(classify("Wall Street Just Had Its Worst Day Since April 2025")).toMatchObject({ themes: ["marche"], ton: -1 });
    expect(classify("Morgan Stanley downgrades Tesla, cuts price target").themes).toContain("analystes");
    expect(classify("FTC opens antitrust probe into Microsoft").themes).toContain("reglementation");
  });
  it("8-K : rubriques et « Regulation FD » qui n'est pas de la réglementation", () => {
    expect(classify8K(["2.02", "7.01"], "Results of Operations and Regulation FD Disclosure").themes).toEqual(["resultats"]);
    expect(classify8K(["5.02"], "").themes).toContain("dirigeants");
    expect(classify8K(["4.02"], "").ton).toBe(-1);
  });
  it("nom court, surnoms et détection de la société dans un titre", () => {
    expect(shortName("Advanced Micro Devices, Inc.")).toBe("Advanced Micro Devices");
    expect(shortName("Boeing Company (The)")).toBe("Boeing");
    const amd = companyAliases("Advanced Micro Devices, Inc.", "AMD");
    expect(mentions("AMD stock jumps 11%", amd)).toBe(true);
    expect(mentions("Advanced packaging demand rises", amd)).toBe(false);
    expect(mentions("Amex to cut 3,500 jobs", companyAliases("American Express Co", "AXP"))).toBe(true);
    expect(mentions("Bajaj names new CEO", companyAliases("American Express Co", "AXP"))).toBe(false);
  });
});

describe("explication par les nouvelles", () => {
  // 40 séances : l'action chute de 30 % les 5 derniers jours, le marché de 6 %
  const mk = (f: (i: number) => number): Bar[] => Array.from({ length: 40 }, (_, i) => {
    const c = f(i);
    return { date: new Date(Date.UTC(2026, 9, 1) + i * 86400_000).toISOString().slice(0, 10), open: c, high: c, low: c, close: c, volume: 1e6 };
  });
  const bars = mk((i) => (i < 35 ? 100 : 100 - (i - 34) * 6));
  const qqq = mk((i) => (i < 35 ? 100 : 100 - (i - 34) * 1.2));
  const ref = bars[39].date;
  const news = [
    { date: bars[36].date, kind: "officiel" as const, titre: "2.02", resume: "AMD Reports Third Quarter 2026 Financial Results", items: "2.02,9.01", themes: "resultats", ton: 0 },
    { date: bars[37].date, kind: "presse" as const, titre: "AMD stock tumbles after weak guidance", source: "cnbc.com", themes: "previsions", ton: -1 },
    { date: bars[37].date, kind: "presse" as const, titre: "Hong Kong food festival opens", source: "x.com", themes: "", ton: 0 },
    { date: bars[38].date, kind: "presse" as const, titre: "Nasdaq falls into correction as AI stocks slump", source: "reuters.com", themes: "marche,ia", ton: -1 },
  ];
  const a = explainWithNews({ sens: "achat", refDate: ref, source: "ARK", operation: "Achat" }, bars, qqq, qqq, news, true, undefined, companyAliases("Advanced Micro Devices, Inc.", "AMD"));

  it("hypothèses : résultats, repli du marché, décrochage propre à l'action", () => {
    const titres = a.hypotheses.map((h) => h.titre);
    expect(titres[0]).toBe("Achat après des résultats mal accueillis (achat dans la faiblesse)");
    expect(titres).toContain("Achat dans un repli général du marché");
    expect(titres).toContain("Achat d'une action qui a décroché plus que le marché");
    expect(a.hypotheses[0].preuves.join(" ")).toContain("AMD Reports Third Quarter 2026 Financial Results");
  });
  it("chronologie : annonce, presse pertinente, marché, fortes séances, jour de l'achat — sans le bruit", () => {
    const kinds = a.chronologie.map((e) => e.kind);
    expect(kinds).toContain("officiel");
    expect(kinds).toContain("cours");
    expect(a.chronologie.at(-1)).toMatchObject({ kind: "operation", titre: "Jour de l'achat" });
    expect(a.chronologie.some((e) => e.titre.includes("Hong Kong"))).toBe(false);
    expect(a.chronologie.find((e) => e.titre.startsWith("Nasdaq"))?.detail).toContain("ne cite pas la société");
  });
  it("contexte chiffré et résumé", () => {
    expect(a.contexte.action5!).toBeLessThan(-0.15);
    expect(a.resume).toMatch(/^Explication la plus probable : achat après des résultats mal accueillis/);
  });
  it("opération de rémunération : rattachée à son calendrier, pas à l'actualité", () => {
    const b = explainWithNews({ sens: "vente", refDate: ref, source: "FORM4", operation: "Vente (après exercice d'options)" }, bars, qqq, qqq, [], true);
    expect(b.hypotheses[0]).toMatchObject({ confiance: "forte", titre: expect.stringContaining("rémunération") });
  });
});
