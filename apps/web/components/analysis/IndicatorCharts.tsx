import type { ChartData, IndicatorId } from "@tracker/core";
import { COL, MiniChart } from "./MiniChart";

const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2)).replace(".", ",");

/** Le graphique de chacun des 8 modèles, sur ~6 mois autour de l'opération. */
export function IndicatorChart({ id, c, win }: { id: IndicatorId; c: ChartData; win?: [number, number] }) {
  const n = c.dates.length, ref = c.refIndex, ps = c.periodStart;
  switch (id) {
    case "rsi":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps} domain={[0, 100]}
        yZones={[{ from: 70, to: 100, color: COL.red }, { from: 0, to: 30, color: COL.green }]}
        hlines={[{ y: 70, color: COL.muted, dash: "4 3", label: "70" }, { y: 30, color: COL.muted, dash: "4 3", label: "30" }]}
        lines={[{ values: c.rsi, color: COL.main, width: 1.6 }]} />;
    case "mm":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps}
        lines={[{ values: c.close, color: COL.muted, width: 1 }, { values: c.sma20, color: COL.main }, { values: c.sma50, color: COL.blue, width: 1.6 }, { values: c.sma200, color: COL.amber, width: 1.4 }]} />;
    case "macd":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps}
        bars={{ values: c.macdHist, colors: (v) => (v >= 0 ? COL.blue : "#4a5568") }}
        hlines={[{ y: 0, color: COL.muted }]}
        lines={[{ values: c.macd, color: COL.main, width: 1.5 }, { values: c.macdSignal, color: COL.amber, width: 1.1 }]} />;
    case "bollinger":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps}
        bands={[{ upper: c.bbUpper, lower: c.bbLower, color: COL.blue, opacity: 0.16 }]}
        lines={[{ values: c.bbUpper, color: COL.blue, width: 1 }, { values: c.bbLower, color: COL.blue, width: 1 }, { values: c.bbMid, color: COL.blue, width: 0.8, dash: "3 3" }, { values: c.close, color: COL.main, width: 1.5 }]} />;
    case "volume":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps}
        lines={[{ values: c.close, color: COL.main, width: 1.5 }]}
        extraBottom={{ height: 0.42, bars: { values: c.volume, colors: (_, i) => (i === ref ? COL.amber : i > 0 && c.close[i] >= c.close[i - 1] ? COL.blue : "#4a5568") } }} />;
    case "sr":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps}
        hlines={[
          ...c.levels.filter((l) => l.touches >= 2 && l.price !== c.support && l.price !== c.resistance).map((l) => ({ y: l.price, color: COL.muted, dash: "2 4", opacity: 0.7 })),
          // Étiquettes écartées quand support et résistance sont proches
          ...(c.support != null ? [{ y: c.support, color: COL.green, label: fmt(c.support), labelDy: 5 }] : []),
          ...(c.resistance != null ? [{ y: c.resistance, color: COL.red, label: fmt(c.resistance), labelDy: -5 }] : []),
        ]}
        lines={[{ values: c.close, color: COL.main, width: 1.5 }]} />;
    case "fibo":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps}
        hlines={c.fib.map((f) => ({ y: f.price, color: f.ratio === 0.382 || f.ratio === 0.5 || f.ratio === 0.618 ? COL.blue : COL.muted, dash: f.ratio === 0 || f.ratio === 1 ? undefined : "4 3", label: `${(f.ratio * 100).toFixed(1).replace(".0", "").replace(".", ",")} %` }))}
        lines={[{ values: c.close, color: COL.main, width: 1.5 }]} />;
    case "stoch":
      return <MiniChart win={win} n={n} refIndex={ref} periodStart={ps} domain={[0, 100]}
        yZones={[{ from: 80, to: 100, color: COL.red }, { from: 0, to: 20, color: COL.green }]}
        hlines={[{ y: 80, color: COL.muted, dash: "4 3", label: "80" }, { y: 20, color: COL.muted, dash: "4 3", label: "20" }]}
        lines={[{ values: c.stochK, color: COL.main, width: 1.5 }, { values: c.stochD, color: COL.blue, width: 1.3 }]} />;
  }
}

export const LEGENDS: Record<IndicatorId, { label: string; color: string }[]> = {
  rsi: [{ label: "RSI 14", color: COL.main }],
  mm: [{ label: "Cours", color: COL.muted }, { label: "MM20", color: COL.main }, { label: "MM50", color: COL.blue }, { label: "MM200", color: COL.amber }],
  macd: [{ label: "MACD", color: COL.main }, { label: "Signal", color: COL.amber }, { label: "Histogramme", color: COL.blue }],
  bollinger: [{ label: "Cours", color: COL.main }, { label: "Bandes 20 j, 2σ", color: COL.blue }],
  volume: [{ label: "Cours", color: COL.main }, { label: "Volume (hausse)", color: COL.blue }, { label: "Jour J", color: COL.amber }],
  sr: [{ label: "Support", color: COL.green }, { label: "Résistance", color: COL.red }],
  fibo: [{ label: "Cours", color: COL.main }, { label: "Zone 38,2–61,8 %", color: COL.blue }],
  stoch: [{ label: "%K", color: COL.main }, { label: "%D", color: COL.blue }],
};
