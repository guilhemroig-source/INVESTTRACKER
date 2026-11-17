import { NextResponse } from "next/server";
import { getCalendrier, getDb, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Calendrier J−7 à J+45 : résultats et nouvelles de mes actions et de celles des investisseurs, Fed, échéances 13F. */
export function GET() {
  return NextResponse.json(getCalendrier(getDb(), todayParis()));
}
