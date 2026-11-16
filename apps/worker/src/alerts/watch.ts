import { type Db, getWatchState, setWatchState, todayParis, watchMatches } from "@tracker/core";
import { ascii, MAX_SMS } from "./daily";
import { sendSms } from "../sms/providers";

/**
 * Alertes de la liste de suivi : après chaque collecte, les nouvelles opérations qui concernent une action
 * ou un investisseur suivi (ou une action qui franchit le seuil de score) partent dans un SMS groupé.
 */
export async function runWatchAlerts(db: Db, opts: { dryRun?: boolean } = {}) {
  const now = new Date().toISOString();
  const since = getWatchState(db) ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  const found = watchMatches(db, since, todayParis());
  const textes = [...new Set(found.map((m) => m.texte))];
  let sent = false;
  if (textes.length && !opts.dryRun) {
    let text = ascii(`SUIVI investisseurs : ${textes.join(" ; ")}. ${process.env.APP_URL ?? ""}`.trim());
    if (text.length > MAX_SMS) text = ascii(`SUIVI investisseurs : ${textes.length} mouvements sur ta liste (${[...new Set(found.map((m) => m.ticker))].slice(0, 12).join(", ")}). ${process.env.APP_URL ?? ""}`.trim()).slice(0, MAX_SMS);
    sent = (await sendSms(db, "suivi", text)).ok;
  }
  if (!opts.dryRun) setWatchState(db, now);
  return { textes, sent };
}
