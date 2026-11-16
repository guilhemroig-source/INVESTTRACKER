import { NextResponse } from "next/server";
import { addWatch, getDb, listWatch, watchFeed, type WatchInput } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Liste de suivi : règles et fil des opérations correspondantes. */
export function GET() {
  const db = getDb();
  return NextResponse.json({ rules: listWatch(db), feed: watchFeed(db) });
}

/** Ajoute une règle { type: 'action' | 'investisseur' | 'score', valeur, sens? }. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as WatchInput;
    return NextResponse.json(addWatch(getDb(), body), { status: 201 });
  } catch (e) {
    return NextResponse.json({ erreur: (e as Error).message }, { status: 400 });
  }
}
