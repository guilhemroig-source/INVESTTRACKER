import { NextResponse } from "next/server";
import { addJournal, getDb, listJournal, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Journal de décisions (option ?ticker=NVDA). */
export function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("ticker");
  return NextResponse.json(listJournal(getDb(), todayParis(), t ? t.toUpperCase() : undefined));
}

export async function POST(req: Request) {
  try { return NextResponse.json(addJournal(getDb(), await req.json(), todayParis()), { status: 201 }); }
  catch (e) { return NextResponse.json({ erreur: (e as Error).message }, { status: 400 }); }
}
