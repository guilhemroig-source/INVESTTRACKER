import { NextResponse } from "next/server";
import { getActionData, getDb, mesEntrees, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Page action : cours, opérations des investisseurs, annonces et presse, fiche, suivi. */
export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const db = getDb(), t = decodeURIComponent(ticker).toUpperCase(), today = todayParis();
  return NextResponse.json({ ...getActionData(db, t, today), mesEntrees: mesEntrees(db, t, today) });
}
