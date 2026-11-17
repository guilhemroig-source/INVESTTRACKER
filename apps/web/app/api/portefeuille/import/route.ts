import { NextResponse } from "next/server";
import { type LigneImport, getDb, importLignes, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/**
 * Importe des lignes relevées dans l'appli d'un courtier :
 * { lignes: [{ ticker, nom?, compte, valeur, gain? | gainPct?, cotation?: marche|manuel|crypto, indice?, peaEligible?, date?, releveLe?, source? }] }
 * Montants en euros. Les lignes dont le cours manque restent en attente et sont reprises automatiquement.
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { lignes: LigneImport[] };
    if (!Array.isArray(b.lignes) || !b.lignes.length) throw new Error("Aucune ligne");
    return NextResponse.json(importLignes(getDb(), b.lignes, todayParis()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ erreur: (e as Error).message }, { status: 400 });
  }
}
