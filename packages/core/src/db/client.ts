import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

/** Racine du dépôt : premier dossier parent contenant pnpm-workspace.yaml. */
export function repoRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export type Db = BetterSQLite3Database<typeof schema>;

const g = globalThis as unknown as { __trackerDb?: Db };

export function getDb(): Db {
  if (g.__trackerDb) return g.__trackerDb;
  const file = process.env.DATABASE_PATH || path.join(repoRoot(), "var", "tracker.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  g.__trackerDb = db;
  return db;
}

function migrationsFolder(): string {
  // Fonctionne depuis les sources (tsx) comme depuis Next (cwd = apps/web).
  const candidates = [
    path.join(repoRoot(), "packages", "core", "drizzle"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}
