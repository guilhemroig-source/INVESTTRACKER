import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "@tracker/core";

/** Charge le .env de la racine du dépôt (sans écraser les variables déjà définies). */
export function loadEnv() {
  const file = path.join(repoRoot(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

/** En-tête User-Agent exigé par la SEC : un nom et un e-mail de contact. */
export function secUserAgent(): string {
  const ua = process.env.SEC_USER_AGENT?.trim();
  if (!ua || !/@/.test(ua) || /example\.com/.test(ua)) {
    throw new Error("SEC_USER_AGENT manquant ou invalide dans .env : la SEC exige « Nom e-mail@domaine » (ex. \"Tracker Jean Dupont jean@exemple.fr\").");
  }
  return ua;
}

/** User-Agent honnête pour les autres sites (identifie l'outil, sans se faire passer pour un navigateur). */
export const TOOL_UA = "TrackerGrandsInvestisseurs/0.1 (usage personnel)";
