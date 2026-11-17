import { NextResponse } from "next/server";
import { getApercu, getDb, todayParis } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Vue d'ensemble du haut de page : actions à suivre, sous pression vendeuse, mes actifs, la semaine. */
export function GET() {
  return NextResponse.json(getApercu(getDb(), todayParis()));
}
