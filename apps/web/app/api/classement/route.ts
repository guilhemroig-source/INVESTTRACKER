import { NextResponse } from "next/server";
import { getClassement, getDb, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Classement des actions traitées par les investisseurs suivis (90 jours). */
export function GET() {
  return NextResponse.json(getClassement(getDb(), todayParis()));
}
