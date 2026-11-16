import { NextResponse } from "next/server";
import { getDb, getFiche, getTradeAnalysis, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Analyse technique d'une opération (JSON), chargée quand on déplie une ligne. */
export async function GET(_req: Request, { params }: { params: Promise<{ cle: string }> }) {
  const { cle } = await params;
  const res = getTradeAnalysis(getDb(), decodeURIComponent(cle));
  if (!res) return NextResponse.json({ erreur: "Opération inconnue" }, { status: 404 });
  return NextResponse.json({ sens: res.op.sens, ticker: res.op.ticker, analysis: res.analysis, news: res.news, fiche: getFiche(getDb(), res.op.ticker, todayParis()) });
}
