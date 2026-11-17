import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import * as s from "./db/schema";

/** Secteurs Finnhub en français (les plus courants ; les autres restent en anglais). */
export const SECTEURS: Record<string, string> = {
  "Aerospace & Defense": "Aéronautique et défense", Airlines: "Transport aérien", Auto: "Automobile", Automobiles: "Automobile", Banking: "Banque", Beverages: "Boissons",
  Biotechnology: "Biotechnologie", Building: "Bâtiment", Chemicals: "Chimie", Commercial: "Services aux entreprises", Communications: "Télécommunications",
  Construction: "Construction", "Consumer products": "Produits de consommation", Distributors: "Distribution", "Diversified Consumer Services": "Services aux particuliers",
  "Electrical Equipment": "Équipements électriques", Electronic: "Électronique", Energy: "Énergie", "Financial Services": "Services financiers",
  "Food Products": "Agroalimentaire", "Health Care": "Santé", "Hotels, Restaurants & Leisure": "Hôtellerie, restauration et loisirs", "Industrial Conglomerates": "Conglomérat industriel",
  Insurance: "Assurance", "Leisure Products": "Loisirs", "Life Sciences Tools & Services": "Outils pour les sciences de la vie", Logistics: "Logistique", Machinery: "Machines",
  Marine: "Transport maritime", Media: "Médias et divertissement", "Metals & Mining": "Métaux et mines", "N/A": "Non classé", Packaging: "Emballage", Pharmaceuticals: "Pharmacie",
  "Professional Services": "Services professionnels", "Real Estate": "Immobilier", Retail: "Commerce de détail", Road: "Transport routier", Semiconductors: "Semi-conducteurs",
  Software: "Logiciels", Technology: "Technologie", "Textiles, Apparel & Luxury Goods": "Textile, habillement et luxe", Tobacco: "Tabac", "Trading Companies & Distributors": "Négoce et distribution",
  Transportation: "Transports", Utilities: "Services aux collectivités (énergie, eau)", "Tech": "Technologie",
};
export const secteurFr = (x: string | null | undefined) => (x ? SECTEURS[x] ?? x : null);

export interface Profil {
  ticker: string; nom: string | null; secteur: string | null; pays: string | null; bourse: string | null; ipo: string | null;
  capitalisation: number | null; site: string | null; logo: string | null; description: string | null; langue: string | null; wikipedia: string | null;
}
export interface Nouvelle { date: string; heure: string | null; titre: string; source: string; url: string | null; resume: string | null }

export function getProfil(db: Db, ticker: string): Profil | null {
  const p = db.select().from(s.profils).where(eq(s.profils.ticker, ticker)).get();
  if (!p || !p.profilLe) return null;
  return { ticker, nom: p.nom, secteur: secteurFr(p.secteur), pays: p.pays, bourse: p.bourse, ipo: p.ipo, capitalisation: p.capitalisation, site: p.site, logo: p.logo, description: p.description, langue: p.langue, wikipedia: p.wikipedia };
}

/** Dernières nouvelles d'une société (Finnhub), les plus récentes d'abord. */
export function getNouvelles(db: Db, ticker: string, limit = 15): Nouvelle[] {
  return db.select().from(s.evenements).where(and(eq(s.evenements.ticker, ticker), eq(s.evenements.type, "nouvelle")))
    .orderBy(desc(s.evenements.date), desc(s.evenements.heure)).limit(limit).all()
    .map((e) => ({ date: e.date, heure: e.heure, titre: e.titre, source: e.source, url: e.url, resume: e.details ? (JSON.parse(e.details).resume as string) || null : null }));
}

/** Première phrase (ou deux si la première est courte) : le « laïus » affiché dans les fiches. */
export function phraseActivite(description: string | null | undefined, max = 260): string | null {
  if (!description) return null;
  const phrases = description.replace(/\n/g, " ").match(/[^.!?]+[.!?]+(\s|$)/g) ?? [description];
  let t = phrases[0].trim();
  if (t.length < 90 && phrases[1]) t += " " + phrases[1].trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
