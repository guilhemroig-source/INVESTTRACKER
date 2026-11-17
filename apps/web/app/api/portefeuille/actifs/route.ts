import { NextResponse } from "next/server";
import { addCoursManuel, getDb, listActifs, todayParis, upsertActif } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Actifs hors actions américaines (ETF européen, action française, fonds non coté, crypto). */
export function GET() {
  return NextResponse.json(listActifs(getDb()));
}

/**
 * Déclare un actif { ticker, nom, devise, cotation: manuel|crypto, indice?, peaEligible?, note? }
 * et, si fourni, son cours actuel { cours, date? } (saisie manuelle).
 */
export async function POST(req: Request) {
  try {
    const db = getDb();
    const b = await req.json();
    const a = upsertActif(db, b);
    const c = b.cours ? addCoursManuel(db, { ticker: a.ticker, date: b.date || todayParis(), cours: Number(b.cours), devise: a.devise }) : null;
    return NextResponse.json({ actif: a, cours: c }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ erreur: (e as Error).message }, { status: 400 });
  }
}
