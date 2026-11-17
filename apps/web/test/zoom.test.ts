import { describe, expect, it } from "vitest";
import { panWin, selectWin, zoomWin } from "../lib/zoom";

describe("zoom des graphiques", () => {
  it("rapproche autour du centre et reste dans la série", () => {
    expect(zoomWin([0, 99], 100, 0.5)).toEqual([25, 74]);
    expect(zoomWin([0, 99], 100, 2)).toEqual([0, 99]);
    expect(zoomWin([0, 99], 100, 0.5, 90)).toEqual([45, 95]);
  });
  it("ne descend pas sous la largeur minimale", () => {
    const w = zoomWin([40, 50], 100, 0.1);
    expect(w[1] - w[0]).toBe(9);
  });
  it("se déplace sans sortir de la série", () => {
    expect(panWin([0, 49], 100, -0.5)).toEqual([0, 49]);
    expect(panWin([0, 49], 100, 0.5)).toEqual([25, 74]);
    expect(panWin([50, 99], 100, 0.5)).toEqual([50, 99]);
  });
  it("sélection à la souris, dans un sens ou dans l'autre", () => {
    expect(selectWin(60, 20, 100)).toEqual([20, 60]);
    expect(selectWin(50, 52, 100)[1] - selectWin(50, 52, 100)[0]).toBe(9);
  });
});
