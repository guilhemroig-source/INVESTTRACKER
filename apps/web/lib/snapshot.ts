/** Version publiée sans serveur (lien instantané) : données intégrées à la page, exposées par le point d'entrée. */
export type Snapshot = {
  analyse?: (cle: string) => unknown;
  classement?: unknown;
  fiche?: (t: string) => unknown;
  miroirs?: unknown;
  miroir?: (acteur: string) => unknown;
  action?: (t: string) => unknown;
};
export const snap = (): Snapshot | undefined => (globalThis as unknown as { __TRACKER_SNAPSHOT__?: Snapshot }).__TRACKER_SNAPSHOT__;

/** Lit depuis l'API du serveur, ou depuis l'instantané quand la page est publiée sans serveur. */
export async function load<T>(url: string, fromSnap?: (s: Snapshot) => unknown): Promise<T> {
  const s = snap();
  if (s && fromSnap) {
    const v = fromSnap(s);
    if (v == null) throw new Error("donnée absente de l'instantané");
    return v as T;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Ancre de la page d'une action (#action-BRK-B ; seuls lettres, chiffres et tirets sont permis). */
export const actionHash = (ticker: string) => `#action-${ticker.replace(/\./g, "-")}`;
export const tickerFromHash = (h: string) => (h.startsWith("action-") ? h.slice(7).replace(/-/g, ".").toUpperCase() : null);
