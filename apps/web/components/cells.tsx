import { fmtDate, sensClass } from "@/lib/format";
import { actionHash } from "@/lib/snapshot";

/** Symbole en badge ambre, suivi du nom réel de la société. */
export function Sym({ t, name, link = true }: { t: string; name?: string | null; link?: boolean }) {
  return (
    <>
      {link ? <a className="sym sym-link" href={actionHash(t)} title={`Page ${t} : cours annoté, opérations, fiche`}>{t}</a> : <span className="sym">{t}</span>}
      {name ? <span className="co">{name}</span> : null}
    </>
  );
}

export function OpCell({ op, sens }: { op: string; sens: string }) {
  return (
    <td className={`op ${sensClass(sens)}`}>
      <span className="pill" title={op}>{op}</span>
    </td>
  );
}

export function Who({ qui }: { qui: string }) {
  const m = /^(.*?)\s*\((.*)\)$/.exec(qui);
  if (!m) return <>{qui}</>;
  return (
    <>
      {m[1]} <span className="who-role">({m[2]})</span>
    </>
  );
}

/** Pastille « EDGAR » : lien vers la déclaration officielle quand il est connu. */
export function EdgarBadge({ url, title }: { url?: string | null; title?: string }) {
  if (url) return <a className="ok-badge" href={url} target="_blank" rel="noreferrer" title={title ?? "Voir la déclaration sur SEC EDGAR"}>EDGAR ↗</a>;
  return <span className="ok-badge" title={title ?? "Vérifié sur SEC EDGAR"}>EDGAR</span>;
}

export function EmptyRow({ cols, text = "Aucune ligne ne correspond." }: { cols: number; text?: string }) {
  return (
    <tr>
      <td className="empty" colSpan={cols}>{text}</td>
    </tr>
  );
}

export interface SourceStatus { source: string; dernier_ok: string | null; donnees_au: string | null; derniere_erreur: string | null }

/** « Données au … » : toujours la dernière donnée connue, avec sa date ; jamais d'estimation. */
export function FreshLine({ status, sources, label }: { status: SourceStatus[]; sources: string[]; label?: string }) {
  const rows = status.filter((s) => sources.some((p) => s.source === p || s.source.endsWith(":" + p)));
  if (!rows.length) return <p className="fresh-line warn">Aucune collecte réussie pour cette source.</p>;
  const donnees = rows.map((r) => r.donnees_au).filter(Boolean).sort().at(-1) ?? null;
  const ok = rows.map((r) => r.dernier_ok).filter(Boolean).sort().at(-1) ?? null;
  const err = rows.map((r) => r.derniere_erreur).filter(Boolean).sort().at(-1) ?? null;
  const failing = err && (!ok || err > ok);
  return (
    <p className="fresh-line">
      {label ?? "Données"} au <b>{fmtDate(donnees)}</b> · dernière collecte réussie le {fmtDate(ok?.slice(0, 10))}
      {failing ? <span className="warn"> · dernière collecte en échec : affichage de la dernière donnée connue</span> : null}
    </p>
  );
}

export type AnalysisMap = Record<string, { statut: string; pour: number; contre: number; ton: string }>;

/** Résumé de l'analyse technique (« 6/8 ») ; la ligne se déplie au clic pour afficher l'explication. */
export function SignalCell({ cle, analyses }: { cle: string; analyses: AnalysisMap }) {
  const a = analyses[cle];
  const title = !a ? "Cours en attente de téléchargement" : a.statut !== "ok" ? "Historique de cours insuffisant"
    : a.ton === "coherent" ? `${a.pour} indicateurs sur 8 allaient dans ce sens` : a.ton === "contre" ? `À contre-courant : ${a.contre} indicateurs sur 8 disaient l'inverse` : `Signaux mitigés : ${a.pour} pour, ${a.contre} contre`;
  return (
    <td className="r nw">
      <span className={`sig ${a?.statut === "ok" ? a.ton : ""}`} title={title}>
        {a?.statut === "ok" ? `${a.pour}/8` : "analyse"} <span className="chev">▾</span>
      </span>
    </td>
  );
}
