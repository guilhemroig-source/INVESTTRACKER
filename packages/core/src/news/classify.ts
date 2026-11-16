/**
 * Classement des nouvelles par thème et tonalité, par règles lisibles (mots-clés anglais et français).
 * Pas d'IA : chaque étiquette s'explique par un mot du titre.
 */

export const THEMES = {
  resultats: { label: "Résultats", re: /\b(earnings|results|quarter(ly)?|q[1-4]\b|revenue|eps|profit|loss|beats?|miss(es|ed)?|résultats?|chiffre d'affaires|bénéfice)\b/i },
  previsions: { label: "Prévisions", re: /\b(guidance|outlook|forecast|expects?|projects?|raises? (its )?(guidance|forecast)|cuts? (its )?(guidance|forecast)|prévisions?|objectifs?)\b/i },
  analystes: { label: "Analystes", re: /\b(upgrade[sd]?|downgrade[sd]?|price target|rating|overweight|underweight|outperform|underperform|initiates? coverage|analyst|relève|abaisse|objectif de cours)\b/i },
  rachat: { label: "Rachat d'actions / dividende", re: /\b(buyback|repurchase|dividend|rachat|dividende)\b/i },
  operation: { label: "Fusion / acquisition", re: /\b(acquir(e|es|ed|ing|sition)|merger|takeover|buyout|deal to buy|spin-?off|stake|rachète|acquisition|fusion|offre publique)\b/i },
  contrat: { label: "Contrat / partenariat", re: /\b(contract|partnership|agreement|deal with|order[s]? from|wins?|award(ed)?|supply|contrat|partenariat|commande)\b/i },
  produit: { label: "Produit / innovation", re: /\b(launch(es|ed)?|unveil(s|ed)?|new (chip|product|model)|approval|fda|trial|patent|lancement|homologation)\b/i },
  reglementation: { label: "Réglementation / justice", re: /\b(lawsuit|sues?|sued|probe|investigation|sec charges|antitrust|fine[sd]?|ban|tariffs?|export (curbs|controls|restrictions)|regulat\w*|moratorium|court|plainte|enquête|amende|droits de douane)\b/i },
  dirigeants: { label: "Dirigeants / gouvernance", re: /\b(ceo|cfo|chief executive|resign(s|ed|ation)?|steps? down|appoint(s|ed)?|names? new|board|succession|démission|nomination|directeur général)\b/i },
  initie: { label: "Mouvements d'initiés / fonds", re: /\b(insider|sold by|bought by|stake (sold|raised|cut)|13f|position in|shares (sold|bought)|holdings?|ark invest|cathie wood|buffett|berkshire)\b/i },
  marche: { label: "Marché / macro", re: /\b(wall street|nasdaq|s&p|dow|stocks? (fall|fell|drop|slump|rally|rise|tumble)|sell-?off|correction|bear market|fed|rates?|inflation|recession|midterm|election|bourse|marchés?)\b/i },
  ia: { label: "Intelligence artificielle", re: /\b(ai|artificial intelligence|gpu|data cent(er|re)s?|nvidia|openai|chatgpt|llm|ia)\b/i },
} as const;
export type ThemeId = keyof typeof THEMES;

const POS = /\b(beats?|surge[sd]?|soar(s|ed)?|jump(s|ed)?|rall(y|ies|ied)|gains?|record|upgrade[sd]?|raises?|strong|boost(s|ed)?|tops?|outperform|wins?|buy\b|bullish|rebound(s|ed)?|climbs?|higher|growth|hausse|bondit|record|relève)\b/i;
const NEG = /\b(miss(es|ed)?|plunge[sd]?|crash(es|ed)?|tumble[sd]?|slump(s|ed)?|fall(s|en)?|fell|drop(s|ped)?|downgrade[sd]?|cuts?|weak|loss(es)?|probe|lawsuit|sell-?off|bearish|warns?|worst|bloodbath|wiped|lower|decline[sd]?|concerns?|fears?|correction|chute|baisse|plonge|recule|avertissement)\b/i;

export function classify(title: string): { themes: ThemeId[]; ton: -1 | 0 | 1 } {
  const themes = (Object.keys(THEMES) as ThemeId[]).filter((k) => THEMES[k].re.test(title));
  const p = POS.test(title), n = NEG.test(title);
  return { themes, ton: p && !n ? 1 : n && !p ? -1 : 0 };
}

/** « Advanced Micro Devices, Inc. » -> « Advanced Micro Devices » ; « Boeing Company (The) » -> « Boeing ». */
export function shortName(nom: string): string {
  return nom.replace(/\(the\)/i, "").replace(/\b(class [a-z]|common stock|ordinary shares?|ads|adr)\b.*$/i, "")
    .replace(/[,.]?\s+(inc|incorporated|corp|corporation|co|company|holdings?|group|ltd|limited|plc|n\.?v|s\.?a|ag|lp|llc)\.?\b/gi, "")
    .replace(/\s+/g, " ").replace(/[,.\s]+$/, "").trim();
}

/** Surnoms usuels dans la presse (symbole -> noms). */
const NICKNAMES: Record<string, string[]> = {
  AXP: ["Amex"], GOOG: ["Google", "Alphabet"], GOOGL: ["Google", "Alphabet"], META: ["Facebook", "Meta"], BAC: ["BofA", "Bank of America"],
  "BRK.B": ["Berkshire"], "BRK.A": ["Berkshire"], JPM: ["JPMorgan"], GS: ["Goldman"], MS: ["Morgan Stanley"], TSM: ["TSMC"], BABA: ["Alibaba"],
  KO: ["Coca-Cola"], DIS: ["Disney"], WMT: ["Walmart"], HD: ["Home Depot"], UNH: ["UnitedHealth"], AMZN: ["Amazon"], MSFT: ["Microsoft"],
  AAPL: ["Apple"], NVDA: ["Nvidia"], TSLA: ["Tesla"], SPCX: ["SpaceX"], AVGO: ["Broadcom"], NFLX: ["Netflix"], PLTR: ["Palantir"], CRWV: ["CoreWeave"],
};

/** Façons dont la presse désigne une société : nom court, surnoms usuels, symbole. */
export function companyAliases(nom: string | null, ticker: string): string[] {
  const short = nom ? shortName(nom) : "";
  return [...new Set([short, ...(NICKNAMES[ticker] ?? []), ticker].filter((x) => x && x.length >= 2))];
}

/** Rubriques des formulaires 8-K (SEC), en français. */
export const ITEMS_8K: Record<string, string> = {
  "1.01": "Accord important conclu",
  "1.02": "Fin d'un accord important",
  "1.03": "Faillite ou mise sous administration",
  "1.05": "Incident de cybersécurité",
  "2.01": "Acquisition ou cession réalisée",
  "2.02": "Résultats financiers",
  "2.03": "Nouvelle dette importante",
  "2.04": "Événement accélérant une dette",
  "2.05": "Plan de restructuration / coûts de sortie",
  "2.06": "Dépréciation d'actifs",
  "3.01": "Risque de radiation de la cote",
  "3.02": "Émission d'actions non enregistrée",
  "3.03": "Modification des droits des actionnaires",
  "4.01": "Changement de commissaire aux comptes",
  "4.02": "Comptes antérieurs non fiables",
  "5.01": "Changement de contrôle",
  "5.02": "Départ ou nomination de dirigeants / administrateurs",
  "5.03": "Modification des statuts ou de l'exercice",
  "5.07": "Votes des actionnaires",
  "7.01": "Communication réglementée (Reg FD)",
  "8.01": "Autre événement important",
  "9.01": "États financiers et pièces jointes",
};
/** Rubriques qui portent l'information (9.01 n'est qu'une liste de pièces jointes). */
export const ITEMS_8K_MAJEURS = new Set(Object.keys(ITEMS_8K).filter((k) => k !== "9.01"));

/** Thèmes et tonalité d'un 8-K à partir de ses rubriques. */
export function classify8K(items: string[], summary: string): { themes: ThemeId[]; ton: -1 | 0 | 1 } {
  summary = summary.replace(/regulation fd( disclosure)?/gi, "");
  const t = new Set<ThemeId>(classify(summary).themes);
  if (items.includes("2.02")) t.add("resultats");
  if (items.some((i) => ["1.01", "2.01", "5.01"].includes(i))) t.add("operation");
  if (items.includes("5.02")) t.add("dirigeants");
  if (items.some((i) => ["1.05", "4.02", "3.01", "2.06", "1.03"].includes(i))) t.add("reglementation");
  const neg = items.some((i) => ["1.03", "1.05", "2.04", "2.06", "3.01", "4.02"].includes(i));
  return { themes: [...t], ton: neg ? -1 : classify(summary).ton };
}
