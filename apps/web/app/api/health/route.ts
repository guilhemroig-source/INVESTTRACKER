import { NextResponse } from "next/server";
import { getDb, getCounts } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Contrôle de santé pour l'hébergeur : la base répond et contient des opérations. */
export function GET() {
  try {
    const n = getCounts(getDb()).reduce((a, c) => a + c.n, 0);
    return NextResponse.json({ ok: true, operations: n });
  } catch (e) {
    return NextResponse.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
}
