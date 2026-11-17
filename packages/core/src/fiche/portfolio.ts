import type { Bar } from "../ta/indicators";

/**
 * Mon portefeuille : positions au prix de revient unitaire moyen pondéré (PRU), gains réalisés et latents,
 * dividendes, et comparaison avec un ETF de référence en rejouant exactement les mêmes flux d'argent
 * (chaque achat achète l'ETF pour le même montant, chaque vente en revend pour le même montant).
 */

export interface PortfolioTx { id?: number; date: string; devise?: string; type: "achat" | "vente" | "dividende"; ticker: string; quantite: number; prix: number; frais: number; compte: string; note?: string | null }
export interface Regles { poidsMax: number; baisseMax: number }
export const REGLES_DEFAUT: Regles = { poidsMax: 0.1, baisseMax: 0.25 };
export const FLAT_TAX = 0.3;
/** Comptes : les gains des comptes « flat tax » entrent dans l'impôt estimé (PEA et assurance-vie en sont exclus). */
export const COMPTES = ["CTO", "PEA", "Assurance-vie", "Crypto", "Non coté", "Autre"] as const;
export const COMPTES_FLAT_TAX: readonly string[] = ["CTO", "Crypto", "Non coté"];
export const DEVISES = ["EUR", "USD"] as const;

export interface Position {
  ticker: string; compte: string; quantite: number; pru: number; investi: number; cours: number | null; dateCours: string | null;
  valeur: number | null; gainLatent: number | null; gainLatentPct: number | null; gainRealise: number; dividendes: number; poids: number | null;
  alertes: string[];
}
export interface PortfolioResult {
  positions: Position[];
  totaux: { investiNet: number; valeur: number; gainLatent: number; gainRealise: number; dividendes: number; frais: number; gainTotal: number; gainTotalPct: number | null; impotEstime: number };
  reference: { ticker: string; libelle: string; valeur: number | null; gainTotal: number | null; gainTotalPct: number | null } | null;
  alertes: string[];
}

const at = (bars: Bar[], date: string) => { let lo = 0, hi = bars.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].date <= date) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? bars[r] : bars[0]; };

export function computePortfolio(
  txs: PortfolioTx[], lastPrice: (t: string) => { cours: number; date: string } | null, ref: { ticker: string; libelle: string; bars: Bar[] } | null,
  regles: Regles = REGLES_DEFAUT, extra: (t: string) => string[] = () => [],
): PortfolioResult {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
  const pos = new Map<string, Position>();
  let frais = 0, entrees = 0, sorties = 0;
  // Référence : parts d'ETF achetées et revendues aux mêmes dates pour les mêmes montants
  let refParts = 0, refSorties = 0;
  for (const t of sorted) {
    const k = `${t.ticker}|${t.compte}`;
    const p = pos.get(k) ?? { ticker: t.ticker, compte: t.compte, quantite: 0, pru: 0, investi: 0, cours: null, dateCours: null, valeur: null, gainLatent: null, gainLatentPct: null, gainRealise: 0, dividendes: 0, poids: null, alertes: [] };
    frais += t.frais;
    const refPx = ref?.bars.length ? at(ref.bars, t.date).close : null;
    if (t.type === "achat") {
      const cout = t.quantite * t.prix + t.frais;
      p.pru = (p.pru * p.quantite + cout) / (p.quantite + t.quantite);
      p.quantite += t.quantite;
      entrees += cout;
      if (refPx) refParts += cout / refPx;
    } else if (t.type === "vente") {
      const q = Math.min(t.quantite, p.quantite);
      const produit = q * t.prix - t.frais;
      p.gainRealise += produit - q * p.pru;
      p.quantite -= q;
      if (p.quantite <= 1e-9) { p.quantite = 0; p.pru = 0; }
      sorties += produit;
      if (refPx) { refParts -= produit / refPx; refSorties += produit; }
    } else {
      p.dividendes += t.prix - t.frais;
      sorties += t.prix - t.frais;
    }
    pos.set(k, p);
  }
  const positions = [...pos.values()];
  for (const p of positions) {
    p.investi = p.quantite * p.pru;
    const lp = lastPrice(p.ticker);
    if (lp && p.quantite > 0) {
      p.cours = lp.cours; p.dateCours = lp.date; p.valeur = p.quantite * lp.cours;
      p.gainLatent = p.valeur - p.investi; p.gainLatentPct = p.investi ? p.gainLatent / p.investi : null;
    }
  }
  const ouvertes = positions.filter((p) => p.quantite > 0);
  const valeur = ouvertes.reduce((a, p) => a + (p.valeur ?? p.investi), 0);
  const alertes: string[] = [];
  for (const p of ouvertes) {
    p.poids = valeur ? (p.valeur ?? p.investi) / valeur : null;
    if (p.poids != null && p.poids > regles.poidsMax) p.alertes.push(`Pèse ${Math.round(p.poids * 100)} % du portefeuille (règle : ${Math.round(regles.poidsMax * 100)} % max)`);
    if (p.gainLatentPct != null && p.gainLatentPct <= -regles.baisseMax) p.alertes.push(`Perte de ${Math.round(-p.gainLatentPct * 100)} % sur le prix de revient (seuil de revue : ${Math.round(regles.baisseMax * 100)} %)`);
    p.alertes.push(...extra(p.ticker));
    for (const a of p.alertes) alertes.push(`${p.ticker} : ${a}`);
  }
  const gainLatent = ouvertes.reduce((a, p) => a + (p.gainLatent ?? 0), 0);
  const gainRealise = positions.reduce((a, p) => a + p.gainRealise, 0);
  const dividendes = positions.reduce((a, p) => a + p.dividendes, 0);
  const gainTotal = valeur + sorties - entrees;
  const cto = positions.filter((p) => COMPTES_FLAT_TAX.includes(p.compte));
  const baseCto = cto.reduce((a, p) => a + p.gainRealise + p.dividendes + (p.gainLatent ?? 0), 0);
  let reference: PortfolioResult["reference"] = null;
  if (ref?.bars.length && entrees) {
    const refVal = refParts * ref.bars[ref.bars.length - 1].close;
    const g = refVal + refSorties - entrees;
    reference = { ticker: ref.ticker, libelle: ref.libelle, valeur: refVal, gainTotal: g, gainTotalPct: g / entrees };
  }
  return {
    positions: positions.sort((a, b) => (b.valeur ?? 0) - (a.valeur ?? 0)),
    totaux: { investiNet: entrees - sorties, valeur, gainLatent, gainRealise, dividendes, frais, gainTotal, gainTotalPct: entrees ? gainTotal / entrees : null, impotEstime: Math.max(0, baseCto) * FLAT_TAX },
    reference, alertes,
  };
}
