import { NextResponse } from "next/server";
import { getDb, setRegles } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Règles de risque : { poidsMax: 0.1, baisseMax: 0.25, reference: "VT" }. */
export async function PUT(req: Request) {
  try { return NextResponse.json(setRegles(getDb(), await req.json())); }
  catch (e) { return NextResponse.json({ erreur: (e as Error).message }, { status: 400 }); }
}
