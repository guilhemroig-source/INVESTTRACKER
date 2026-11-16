import { NextResponse } from "next/server";
import { getDb, getMirror } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Détail du portefeuille miroir d'un investisseur : positions et courbe face au S&P 500. */
export async function GET(_req: Request, { params }: { params: Promise<{ acteur: string }> }) {
  const { acteur } = await params;
  return NextResponse.json(getMirror(getDb(), decodeURIComponent(acteur)));
}
