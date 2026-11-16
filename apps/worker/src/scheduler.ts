import cron from "node-cron";
import { getDb } from "@tracker/core";
import { ALL_ORDER } from "./collectors";
import { buildDailySms } from "./alerts/daily";
import { runImmediateCheck } from "./alerts/immediate";
import { sendSms } from "./sms/providers";

/**
 * Planning (process long, `pnpm worker`) :
 * - collecte complète à 6h30 et 22h30 (Paris) : la nuit capte les dépôts américains de la veille (jusqu'à 22h à New York) ;
 * - SMS quotidien à 7h47 (Paris), tous les jours, même sans nouveauté ;
 * - vérification EDGAR toutes les heures de 9h à 17h (New York), du lundi au vendredi : alerte immédiate Musk / 13F.
 */
export const SCHEDULE = {
  collecte: { expr: "30 6,22 * * *", timezone: "Europe/Paris" },
  smsQuotidien: { expr: "47 7 * * *", timezone: "Europe/Paris" },
  immediat: { expr: "5 9-17 * * 1-5", timezone: "America/New_York" },
  /** Cours : quota gratuit Tiingo ≈ 50 requêtes/heure, d'où un passage horaire de 45 actions au plus. */
  prix: { expr: "40 * * * *", timezone: "Europe/Paris" },
} as const;

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

export function startScheduler(collectAll: () => Promise<void>, collectOne: (name: string) => Promise<unknown>) {
  const db = getDb();
  cron.schedule(SCHEDULE.collecte.expr, async () => { log("collecte complète"); await collectAll(); }, { timezone: SCHEDULE.collecte.timezone, name: "collecte", noOverlap: true });
  cron.schedule(SCHEDULE.smsQuotidien.expr, async () => {
    const text = buildDailySms(db);
    const r = await sendSms(db, "quotidien", text);
    log(`SMS quotidien : ${r.ok ? `envoyé via ${r.canal}` : `ÉCHEC ${r.erreur}`}`);
  }, { timezone: SCHEDULE.smsQuotidien.timezone, name: "sms", noOverlap: true });
  cron.schedule(SCHEDULE.immediat.expr, async () => {
    const r = await runImmediateCheck(db);
    log(`vérification immédiate : ${r.sent.length} alerte(s)`);
  }, { timezone: SCHEDULE.immediat.timezone, name: "immediat", noOverlap: true });
  cron.schedule(SCHEDULE.prix.expr, async () => { await collectOne("prix"); }, { timezone: SCHEDULE.prix.timezone, name: "prix", noOverlap: true });
  log(`planificateur démarré (${ALL_ORDER.length} collecteurs) :`);
  for (const [k, v] of Object.entries(SCHEDULE)) log(`  ${k.padEnd(13)} « ${v.expr} » (${v.timezone})`);
}
