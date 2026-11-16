import { describe, expect, it } from "vitest";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtRange, fmtSigned, fmtUsd } from "@/lib/format";
import { displayNameOf } from "@/lib/names";

const n = (s: string) => s.replace(/ /g, " "); // espace fine insécable -> espace, pour la lisibilité des attentes

describe("formatage fr-FR", () => {
  it("montants compacts en dollars", () => {
    expect([935_500, 2_406_600, 326_000_000, 7_094_441_104, 820].map((x) => n(fmtUsd(x)))).toEqual(["936 k$", "2,41 M$", "326 M$", "7,09 Md$", "820 $"]);
    expect(n(fmtUsd(-1_764_000, { signed: true }))).toBe("−1,76 M$");
    expect(fmtUsd(null)).toBe("—");
  });
  it("fourchettes légales (Trump, Congrès)", () => {
    expect(n(fmtRange("$15,001 - $50,000"))).toBe("15 k–50 k$");
    expect(n(fmtRange("$1,000,001 - $5,000,000"))).toBe("1 M–5 M$");
    expect(n(fmtUsd(1_700_000))).toBe("1,7 M$");
    expect(n(fmtUsd(42_300))).toBe("42,3 k$");
    expect(n(fmtRange("Over $50,000,000"))).toBe("> 50 M$");
  });
  it("nombres, prix, pourcentages", () => {
    expect(n(fmtNum(1234567.891, 2))).toBe("1 234 567,89");
    expect(n(fmtSigned(-30000))).toBe("−30 000");
    expect(n(fmtSigned(208971))).toBe("+208 971");
    expect(n(fmtPrice(80.22))).toBe("80,22 $");
    expect(n(fmtPct(-6.9))).toBe("−6,9 %");
  });
  it("dates en français", () => {
    expect(fmtDate("2026-11-06")).toBe("6 nov. 2026");
    expect(fmtDate("2026-08-14", false)).toBe("14 août");
    expect(fmtDate(null)).toBe("—");
  });
  it("noms SEC remis dans l'ordre et en casse normale", () => {
    expect(displayNameOf("Musk Elon")).toBe("Elon Musk");
    expect(displayNameOf("JACKSON JAMERE")).toBe("Jamere Jackson");
    expect(displayNameOf("PLATINUM EQUITY, LLC")).toBe("Platinum Equity, LLC");
    expect(displayNameOf("Grossman Adam S")).toBe("Grossman Adam S");
  });
});
