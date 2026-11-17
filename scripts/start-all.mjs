// Démarrage en production (conteneur) : prépare la base au premier lancement, puis lance l'appli web et le planificateur.
// Si l'un des deux s'arrête, le conteneur s'arrête aussi et l'hébergeur le relance.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Même règle que packages/core (databasePath) : sur Railway, la base va sur le volume attaché s'il y en a un.
let db = process.env.DATABASE_PATH || path.resolve("var/tracker.db");
const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
if (vol && !path.resolve(db).startsWith(path.resolve(vol) + path.sep)) db = path.join(vol, "tracker.db");
process.env.DATABASE_PATH = db; // transmis à l'appli web et au planificateur
console.log(`[démarrage] base : ${db}${vol ? ` (volume Railway monté sur ${vol})` : " (aucun volume Railway détecté : la base sera perdue au prochain déploiement)"}`);
const fresh = !fs.existsSync(db);
const run = (args) => spawnSync("pnpm", ["-s", ...args], { stdio: "inherit" }).status;

if (fresh) {
  console.log(`[démarrage] base absente (${db}) : import du kit de données`);
  if (run(["import-data"]) !== 0) process.exit(1);
}

const children = [
  spawn("pnpm", ["-s", "start"], { stdio: "inherit" }),
  spawn("pnpm", ["-s", "worker"], { stdio: "inherit" }),
];
// Première collecte complète en arrière-plan (sinon il faudrait attendre 6h30 ou 22h30)
if (fresh) spawn("pnpm", ["-s", "collect", "all"], { stdio: "inherit" });

for (const c of children) c.on("exit", (code) => { console.error(`[démarrage] un processus s'est arrêté (code ${code}) : arrêt du conteneur`); for (const o of children) o.kill(); process.exit(code ?? 1); });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { for (const c of children) c.kill(sig); process.exit(0); });
