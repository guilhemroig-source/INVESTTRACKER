import { NextResponse } from "next/server";
import { getDb, removeWatch } from "@tracker/core";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  removeWatch(getDb(), Number(id));
  return NextResponse.json({ ok: true });
}
