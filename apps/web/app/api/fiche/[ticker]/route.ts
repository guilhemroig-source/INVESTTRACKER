import { NextResponse } from "next/server";
import { getDb, getFiche, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Fiche d'une action (onglet Classement). */
export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return NextResponse.json(getFiche(getDb(), decodeURIComponent(ticker).toUpperCase(), todayParis()));
}
