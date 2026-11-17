/** Fenêtre d'affichage [début, fin] (indices inclus) sur une série de n points. */
export type Win = [number, number];

const borne = (w: Win, n: number, min: number): Win => {
  let [a, b] = w;
  let len = Math.max(min - 1, Math.min(n - 1, b - a));
  if (len > n - 1) len = n - 1;
  a = Math.max(0, Math.min(a, n - 1 - len));
  b = a + len;
  return [Math.round(a), Math.round(b)];
};

/** Zoom (facteur < 1 : rapprocher ; > 1 : éloigner) autour d'un indice (centre de la fenêtre par défaut). */
export function zoomWin(w: Win, n: number, facteur: number, centre?: number, min = 10): Win {
  const c = centre ?? (w[0] + w[1]) / 2;
  const len = (w[1] - w[0]) * facteur;
  const part = (c - w[0]) / Math.max(1, w[1] - w[0]);
  return borne([c - len * part, c - len * part + len], n, min);
}

/** Déplacement d'une fraction de la largeur (négatif : vers le passé). */
export function panWin(w: Win, n: number, fraction: number, min = 10): Win {
  const d = (w[1] - w[0]) * fraction;
  return borne([w[0] + d, w[1] + d], n, min);
}

export function selectWin(a: number, b: number, n: number, min = 10): Win {
  return borne([Math.min(a, b), Math.max(a, b)], n, min);
}
