import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, getNouvelles, getProfil, insertIgnore, phraseActivite, schema as s, secteurFr } from "../src";

const db = getDb();
const clean = () => { for (const t of [s.profils, s.evenements]) db.delete(t).run(); };
beforeEach(clean);
afterAll(clean);

describe("profil des sociétés", () => {
  it("phrase d'activité : première phrase, complétée si elle est courte, tronquée si trop longue", () => {
    expect(phraseActivite("Nvidia conçoit des processeurs graphiques pour les jeux vidéo, les centres de données et l'automobile. Elle est basée à Santa Clara.")).toBe("Nvidia conçoit des processeurs graphiques pour les jeux vidéo, les centres de données et l'automobile.");
    expect(phraseActivite("Aecom est un bureau d'études. Il conçoit des infrastructures.")).toBe("Aecom est un bureau d'études. Il conçoit des infrastructures.");
    expect(phraseActivite("x".repeat(400))!.length).toBe(260);
    expect(phraseActivite(null)).toBeNull();
  });
  it("secteur traduit, profil absent tant qu'il n'est pas collecté", () => {
    expect(secteurFr("Semiconductors")).toBe("Semi-conducteurs");
    expect(secteurFr("Something New")).toBe("Something New");
    insertIgnore(db, s.profils, [{ ticker: "NVDA", nouvellesLe: "2026-11-17" }]);
    expect(getProfil(db, "NVDA")).toBeNull(); // seulement les nouvelles suivies
    db.update(s.profils).set({ nom: "NVIDIA Corp", secteur: "Semiconductors", profilLe: "2026-11-17", description: "Nvidia conçoit des GPU.", langue: "fr" }).run();
    expect(getProfil(db, "NVDA")).toMatchObject({ nom: "NVIDIA Corp", secteur: "Semi-conducteurs", langue: "fr" });
  });
  it("nouvelles d'une société, les plus récentes d'abord", () => {
    const n = (cle: string, date: string, heure: string, ticker = "NVDA") => ({ cle, date, heure, ticker, type: "nouvelle", titre: cle, details: JSON.stringify({ resume: "r" }), source: "Reuters", url: null, collecteLe: "x" });
    insertIgnore(db, s.evenements, [n("a", "2026-11-15", "10:00"), n("b", "2026-11-16", "09:00"), n("c", "2026-11-16", "18:00"), n("d", "2026-11-16", "20:00", "AMD")]);
    expect(getNouvelles(db, "NVDA").map((x) => x.titre)).toEqual(["c", "b", "a"]);
    expect(getNouvelles(db, "NVDA")[0]).toMatchObject({ source: "Reuters", resume: "r" });
  });
});
