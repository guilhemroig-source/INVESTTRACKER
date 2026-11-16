import { NextResponse } from "next/server";
import { getActionData, getDb, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Page action : cours, opérations des investisseurs, annonces et presse, fiche, suivi. */
export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return NextResponse.json(getActionData(getDb(), decodeURIComponent(ticker).toUpperCase(), todayParis()));
}
