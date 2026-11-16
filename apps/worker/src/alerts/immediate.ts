import { type Db, quarterEnd, runLogged, schema as s } from "@tracker/core";
import { and, eq, isNotNull } from "drizzle-orm";
import { collectEdgarMusk } from "../collectors/edgar-musk";
import { filingsByPeriod } from "../collectors/thirteenf";
import { ascii } from "./daily";
import { sendSms } from "../sms/providers";
import { runWatchAlerts } from "./watch";

/**
 * Alerte immédiate (hors 7h47) : nouveau formulaire 4 de Musk, ou nouveau 13F-HR d'un fonds suivi sur EDGAR.
 * Chaque message n'est envoyé qu'une fois (dédoublonnage sur la table alerts).
 */
export async function runImmediateCheck(db: Db, opts: { dryRun?: boolean } = {}) {
  const events: string[] = [];
  const musk = await runLogged(db, "edgar-musk", async () => {
    const r = await collectEdgarMusk(db);
    events.push(...(r.evenements ?? []));
    return r;
  });
  await runLogged(db, "immediat:13f-edgar", async () => {
    const funds = db.select().from(s.funds).where(and(isNotNull(s.funds.cik), isNotNull(s.funds.dernierTrimestre))).all();
    for (const f of funds) {
      const byPeriod = await filingsByPeriod(f.cik!);
      const lastEnd = [...byPeriod.keys()].sort().at(-1);
      if (lastEnd && lastEnd > quarterEnd(f.dernierTrimestre!)!) {
        events.push(`Nouveau 13F ${f.investisseur} depose sur EDGAR le ${byPeriod.get(lastEnd)!.fileDate} (fin de trimestre ${lastEnd})`);
      }
    }
    return { lues: funds.length, nouvelles: 0, evenements: events.filter((e) => e.startsWith("Nouveau 13F")) };
  });
  const sent: string[] = [];
  for (const e of events) {
    const text = ascii(`ALERTE investisseurs : ${e}. ${process.env.APP_URL ?? ""}`.trim());
    const already = db.select().from(s.alerts).where(and(eq(s.alerts.type, "immediat"), eq(s.alerts.message, text))).get();
    if (already) continue;
    if (!opts.dryRun) await sendSms(db, "immediat", text);
    sent.push(text);
  }
  // Liste de suivi (nouvelles opérations Musk / 13F de cette vérification)
  if (!opts.dryRun) { const w = await runWatchAlerts(db); sent.push(...w.textes); }
  return { sent, muskOk: musk.ok };
}
