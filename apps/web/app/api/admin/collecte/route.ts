import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Sources lançables à la demande (mêmes noms que `pnpm collect <source>`). */
const SOURCES = ["all", "tickers", "ark", "edgar-musk", "openinsider", "13f", "trump", "congres", "change", "prix", "fondamentaux", "news", "calendrier", "societes"];

const racine = () => {
  let d = process.cwd();
  for (let i = 0; i < 6; i++) { if (fs.existsSync(path.join(d, "pnpm-workspace.yaml"))) return d; d = path.dirname(d); }
  return process.cwd();
};

/**
 * Lance une collecte en arrière-plan : POST /api/admin/collecte?source=13f
 * (protégé comme tout le site par APP_USER / APP_PASSWORD). Le résultat apparaît dans le journal de /admin.
 */
export function POST(req: Request) {
  const source = new URL(req.url).searchParams.get("source") ?? "";
  if (!SOURCES.includes(source)) return NextResponse.json({ erreur: `source inconnue (${SOURCES.join(", ")})` }, { status: 400 });
  const p = spawn("pnpm", ["-s", "collect", source], { cwd: racine(), detached: true, stdio: "ignore", env: process.env });
  p.unref();
  return NextResponse.json({ lance: source, pid: p.pid }, { status: 202 });
}
