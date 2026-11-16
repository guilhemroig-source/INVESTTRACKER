import type { Db } from "@tracker/core";

export interface CollectResult {
  lues: number;
  nouvelles: number;
  donneesAu?: string | null;
  /** Événements notables pour les alertes (ex. « nouveau formulaire 4 de Musk sur TSLA déposé le … »). */
  evenements?: string[];
  details?: string[];
}
export type Collector = (db: Db) => Promise<CollectResult>;

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86400_000));
