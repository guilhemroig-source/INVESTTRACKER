import { NextResponse } from "next/server";
import { deleteJournal, getDb, reviewJournal } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Revue d'une décision : { resultat: bonne|mauvaise|mitigee, lecon }. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { reviewJournal(getDb(), Number((await params).id), await req.json()); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ erreur: (e as Error).message }, { status: 400 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  deleteJournal(getDb(), Number((await params).id));
  return NextResponse.json({ ok: true });
}
