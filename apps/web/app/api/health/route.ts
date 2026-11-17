import { NextResponse } from "next/server";
import { databasePath, getDb, getCounts } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Contrôle de santé pour l'hébergeur : la base répond et contient des opérations. */
export function GET() {
  try {
    const n = getCounts(getDb()).reduce((a, c) => a + c.n, 0);
    // Où vit la base, et si elle est sur un volume persistant (sinon : perdue à chaque déploiement)
    const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? null;
    return NextResponse.json({ ok: true, operations: n, base: databasePath(), volume: vol, persistante: vol ? databasePath().startsWith(vol) : null });
  } catch (e) {
    return NextResponse.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
}
