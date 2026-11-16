import path from "node:path";
import { getCounts, getDb, importKit, repoRoot, runLogged } from "@tracker/core";
import { loadEnv } from "./env";
import "./http";
import { ALL_ORDER, COLLECTORS } from "./collectors";
import type { CollectResult } from "./collectors/types";
import { buildDailySms } from "./alerts/daily";
import { runImmediateCheck } from "./alerts/immediate";
import { providersFromEnv, sendSms } from "./sms/providers";
import { startScheduler } from "./scheduler";

loadEnv();
const [cmd, ...args] = process.argv.slice(2);

async function collect(name: string) {
  const c = COLLECTORS[name];
  if (!c) throw new Error(`Collecteur inconnu : ${name}. Disponibles : ${Object.keys(COLLECTORS).join(", ")}, all`);
  const t0 = Date.now();
  let res: CollectResult | undefined;
  const r = await runLogged(getDb(), name, async () => (res = await c.run(getDb())));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.ok) console.log(`✓ ${name} (${secs} s) : ${r.lues} lues, ${r.nouvelles} nouvelles, données au ${r.donneesAu ?? "—"}`);
  else console.log(`✗ ${name} (${secs} s) : ${r.erreur}`);
  for (const d of res?.details ?? []) console.log(`    · ${d}`);
  for (const e of res?.evenements ?? []) console.log(`    ! ${e}`);
  return r.ok;
}

/** Tous les collecteurs ; secours EDGAR si OpenInsider échoue. Renvoie le nombre d'échecs. */
async function collectAll(): Promise<number> {
  let failed = 0;
  for (const n of ALL_ORDER) {
    const ok = await collect(n);
    if (!ok) failed++;
    if (n === "openinsider" && !ok) {
      console.log("  → OpenInsider indisponible : secours EDGAR");
      if (await collect("edgar-insiders")) failed--; // le secours a pris le relais
    }
  }
  return failed;
}

async function main() {
  switch (cmd) {
    case "migrate":
      getDb();
      console.log("Base à jour.");
      break;
    case "import": {
      const db = getDb();
      const dir = args[0] ? path.resolve(args[0]) : path.join(repoRoot(), "data");
      const res = await importKit(db, dir);
      console.table(Object.entries(res).map(([k, v]) => ({ source: k, ...(v as object) })));
      console.table(getCounts(db));
      break;
    }
    case "collect": {
      const name = args[0];
      if (!name) {
        console.log("Usage : pnpm collect <source|all>\n");
        for (const [k, v] of Object.entries(COLLECTORS)) console.log(`  ${k.padEnd(15)} ${v.description}`);
        return;
      }
      if (name === "all") {
        process.exitCode = (await collectAll()) ? 1 : 0;
      } else {
        process.exitCode = (await collect(name)) ? 0 : 1;
      }
      break;
    }
    case "sms": {
      const db = getDb();
      const sub = args[0] ?? "apercu";
      if (sub === "apercu") {
        const t = buildDailySms(db);
        console.log(`${t}\n\n(${t.length} caractères ; fournisseurs : ${providersFromEnv().map((p) => p.name).join(" > ")}. Envoyer : pnpm sms envoyer)`);
      } else if (sub === "envoyer") {
        const r = await sendSms(db, "quotidien", buildDailySms(db));
        console.log(r.ok ? `SMS quotidien traité via ${r.canal}` : `ÉCHEC : ${r.erreur}`);
        process.exitCode = r.ok ? 0 : 1;
      } else if (sub === "test") {
        const r = await sendSms(db, "test", "Tracker investisseurs : SMS de test. Si vous lisez ceci, l'envoi fonctionne.");
        console.log(r.ok ? `SMS de test traité via ${r.canal}` : `ÉCHEC : ${r.erreur}`);
        process.exitCode = r.ok ? 0 : 1;
      } else console.log("Usage : pnpm sms [apercu|envoyer|test]");
      break;
    }
    case "immediat": {
      const r = await runImmediateCheck(getDb(), { dryRun: args.includes("--dry") });
      console.log(r.sent.length ? r.sent.join("\n") : "Aucune nouvelle déclaration Musk / 13F.");
      break;
    }
    case "worker":
      startScheduler(async () => { await collectAll(); }, collect);
      break;
    default:
      console.log("Usage : pnpm import-data [dossier] | pnpm collect <source|all> | pnpm sms [apercu|envoyer|test] | pnpm immediat [--dry] | pnpm worker | pnpm db:migrate");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
