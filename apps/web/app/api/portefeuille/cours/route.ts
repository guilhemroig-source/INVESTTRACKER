import { NextResponse } from "next/server";
import { addCoursManuel, getDb, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Saisit le cours actuel d'un actif { ticker, cours, date?, devise? } (valeur affichée par le courtier, valeur liquidative…). */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    return NextResponse.json(addCoursManuel(getDb(), { ticker: b.ticker, cours: Number(b.cours), date: b.date || todayParis(), devise: b.devise }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ erreur: (e as Error).message }, { status: 400 });
  }
}
