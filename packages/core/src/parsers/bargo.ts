import type { CongressMemberJson, CongressTradeJson } from "../adapters/congress";

export interface BargoTrade {
  member: string; member_slug: string; chamber: string; state: string | null; ticker: string | null; asset: string | null;
  type: string; amount_range: string | null; transaction_date: string | null; disclosure_date: string; perf_pct: number | null;
  filing_portal?: string | null;
}
export interface BargoMember { member: string; chamber: string; state: string | null; trades: number; buys: number; sells: number; last_trade: string | null }

const CHAMBRE: Record<string, string> = { house: "Chambre", senate: "Sénat" };

/** Réponse JSON de l'API Congrès de Bargo -> format de data/congress_trades.json (achats et ventes d'actions cotées). */
export function bargoTradesToJson(trades: BargoTrade[]): CongressTradeJson[] {
  return trades.flatMap((t) => {
    const type = t.type.toLowerCase();
    if (!t.ticker || !/purchase|sale/.test(type)) return [];
    return [{
      elu: t.member, chambre: CHAMBRE[t.chamber] ?? t.chamber, etat: t.state, ticker: t.ticker.toUpperCase(), societe: null,
      operation: type.startsWith("purchase") ? "Achat" : "Vente", montant: t.amount_range,
      date_transaction: t.transaction_date, date_declaration: t.disclosure_date, perf_pct: t.perf_pct,
    } satisfies CongressTradeJson];
  });
}

export function bargoMembersToJson(members: BargoMember[]): CongressMemberJson[] {
  return members.map((m) => ({
    elu: m.member, chambre: CHAMBRE[m.chamber] ?? m.chamber, etat: m.state,
    transactions: m.trades, achats: m.buys, ventes: m.sells, derniere_transaction: m.last_trade,
  }));
}
