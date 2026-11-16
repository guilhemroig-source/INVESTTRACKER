import { NextResponse } from "next/server";
import { addTx, getDb, getPortfolio, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Mon portefeuille : positions, totaux, comparaison avec l'ETF de référence, alertes de risque, transactions. */
export function GET() {
  return NextResponse.json(getPortfolio(getDb(), todayParis()));
}

/** Ajoute une transaction { date, type: achat|vente|dividende, ticker, quantite, prix, frais, compte, note }. */
export async function POST(req: Request) {
  try { return NextResponse.json(addTx(getDb(), await req.json()), { status: 201 }); }
  catch (e) { return NextResponse.json({ erreur: (e as Error).message }, { status: 400 }); }
}
