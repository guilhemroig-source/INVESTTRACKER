import { fmtRange, fmtSigned, fmtUsd } from "@/lib/format";
import type { DashboardData } from "@tracker/core";

type Op = DashboardData["operations"][number];

function amount(o: Op) {
  if (o.montantUsd != null) return fmtUsd(o.montantUsd);
  if (o.fourchette) return fmtRange(o.fourchette);
  if (o.volume != null) return `${fmtSigned(o.volume)} act.`;
  return "";
}

/** Bandeau défilant : les 40 dernières opérations, en boucle, pause au survol. */
export function Tape({ ops }: { ops: Op[] }) {
  const items = ops.slice(0, 40);
  return (
    <div className="tape" aria-label="Dernières opérations">
      <div className="track" style={{ ["--tk-tape-dur" as string]: `${Math.max(40, items.length * 3.2)}s` }}>
        {items.map((o) => (
          <span key={o.id} className={`it ${o.sens === "achat" ? "up" : "dn"}`}>
            <span className="d">{o.sens === "achat" ? "▲" : "▼"}</span>
            <span className="s">{o.ticker}</span>
            <span className="q">{o.qui.replace(/\s*\(.*\)$/, "")}</span>
            <span className="m">{amount(o)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
