import { NextResponse } from "next/server";
import { deleteTx, getDb } from "@tracker/core";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  deleteTx(getDb(), Number((await params).id));
  return NextResponse.json({ ok: true });
}
