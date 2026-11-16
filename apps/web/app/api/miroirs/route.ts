import { NextResponse } from "next/server";
import { getDb, getMirrors } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Portefeuilles miroirs de tous les investisseurs (résumés). */
export function GET() {
  return NextResponse.json(getMirrors(getDb()));
}
