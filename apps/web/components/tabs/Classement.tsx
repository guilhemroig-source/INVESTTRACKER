"use client";
import { useEffect, useMemo, useState } from "react";
import type { ClassementRow, Fiche } from "@tracker/core";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { EmptyRow, Sym } from "../cells";
import { FicheView } from "../analysis/FicheView";

type Snap = { classement?: ClassementRow[]; fiche?: (t: string) => Fiche | null };
const snap = () => (globalThis as unknown as { __TRACKER_SNAPSHOT__?: Snap }).__TRACKER_SNAPSHOT__;

const p = (x: number | null, d = 0) => (x == null ? "—" : fmtPct(x * 100, d));
const cls = (x: number | null) => (x == null ? "" : x >= 0 ? "buy" : "sell");

type Key = "score" | "acheteurs" | "vendeurs" | "retard" | "per" | "croissanceCa" | "margeNette" | "volatilite" | "force6m" | "derniere";
const COLS: { key: Key; label: string; hide?: boolean }[] = [
  { key: "score", label: "Score" }, { key: "acheteurs", label: "Acheteurs" }, { key: "vendeurs", label: "Vendeurs", hide: true },
  { key: "retard", label: "Depuis achat" }, { key: "per", label: "PER", hide: true }, { key: "croissanceCa", label: "CA 1 an", hide: true },
  { key: "margeNette", label: "Marge", hide: true }, { key: "volatilite", label: "Volatilité", hide: true }, { key: "force6m", label: "Force 6 m.", hide: true },
  { key: "derniere", label: "Dernière", hide: true },
];
const val = (r: ClassementRow, k: Key): number | string | null => (k === "acheteurs" || k === "vendeurs" ? r[k].length : r[k]);

function FicheRow({ r, cols }: { r: ClassementRow; cols: number }) {
  const [open, setOpen] = useState(false);
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || fiche) return;
    const s = snap();
    if (s?.fiche) { const f = s.fiche(r.ticker); f ? setFiche(f) : setErr("fiche indisponible"); return; }
    fetch(`/api/fiche/${encodeURIComponent(r.ticker)}`).then((x) => (x.ok ? x.json() : Promise.reject(new Error(`HTTP ${x.status}`)))).then(setFiche, (e) => setErr(String(e.message)));
  }, [open, fiche, r.ticker]);
  return (
    <>
      <tr className={`xrow-head ${open ? "open" : ""}`} tabIndex={0} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }} title="Cliquer pour voir la fiche">
        <td><Sym t={r.ticker} name={r.societe} /></td>
        <td className="r"><span className={`score-pill s${r.score >= 40 ? 3 : r.score >= 20 ? 2 : r.score > 0 ? 1 : 0}`} title={r.scoreDetail.join("\n")}>{r.score}</span></td>
        <td title={r.acheteurs.join(", ")}><span className="buy">{r.acheteurs.length}</span> <span className="co">{r.acheteurs.slice(0, 2).join(", ")}{r.acheteurs.length > 2 ? "…" : ""}</span></td>
        <td className="r hide-sm" title={r.vendeurs.join(", ")}>{r.vendeurs.length ? <span className="sell">{r.vendeurs.length}</span> : <span className="muted">0</span>}</td>
        <td className={`r ${cls(r.retard)}`}>{p(r.retard)}</td>
        <td className="r hide-sm">{r.per != null ? fmtNum(r.per, 0) : "—"}</td>
        <td className={`r hide-sm ${cls(r.croissanceCa)}`}>{p(r.croissanceCa)}</td>
        <td className={`r hide-sm ${cls(r.margeNette)}`}>{p(r.margeNette)}</td>
        <td className="r hide-sm">{p(r.volatilite)}</td>
        <td className={`r hide-sm ${cls(r.force6m)}`}>{p(r.force6m)}</td>
        <td className="r hide-sm nw">{fmtDate(r.derniere, false)} <span className="chev">▾</span></td>
      </tr>
      {open && (
        <tr className="xrow"><td colSpan={cols}><div className="xpanel">
          {err ? <p className="note sell">Fiche indisponible ({err}).</p> : fiche ? <FicheView fiche={fiche} /> : <p className="note">Calcul de la fiche…</p>}
        </div></td></tr>
      )}
    </>
  );
}

export function Classement() {
  const [rows, setRows] = useState<ClassementRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [min, setMin] = useState(0);
  const [sort, setSort] = useState<{ k: Key; desc: boolean }>({ k: "score", desc: true });
  useEffect(() => {
    const s = snap();
    if (s?.classement) { setRows(s.classement); return; }
    fetch("/api/classement").then((x) => (x.ok ? x.json() : Promise.reject(new Error(`HTTP ${x.status}`)))).then(setRows, (e) => setErr(String(e.message)));
  }, []);
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => r.score >= min && (!qq || r.ticker.toLowerCase().includes(qq) || (r.societe ?? "").toLowerCase().includes(qq) || r.acheteurs.some((a) => a.toLowerCase().includes(qq))))
      .sort((a, b) => {
        const x = val(a, sort.k), y = val(b, sort.k);
        if (x == null) return 1; if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
      });
  }, [rows, q, min, sort]);
  const th = (c: (typeof COLS)[number]) => (
    <th key={c.key} className={`r ${c.hide ? "hide-sm" : ""} sortable`} onClick={() => setSort((s) => ({ k: c.key, desc: s.k === c.key ? !s.desc : true }))} aria-sort={sort.k === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
      {c.label}{sort.k === c.key ? (sort.desc ? " ▾" : " ▴") : ""}
    </th>
  );
  return (
    <section>
      <div className="card">
        <h2>Classement des actions suivies par les investisseurs</h2>
        <p className="note">
          Toutes les actions achetées ou vendues par les investisseurs suivis ces 90 derniers jours. Le <b>score « smart money »</b> (0 à 100) additionne
          des règles simples : acheteurs distincts (initiés, fonds et ARK 15 points, élus 10, Trump 5), achats groupés d&apos;initiés (+20), nouvelles
          positions de grands fonds (+10 chacune), renforcement dans le top 10 d&apos;un fonds (+10), moins les vendeurs (hors ventes de rémunération).
          « Depuis achat » : évolution médiane du cours depuis les achats. Cliquez sur une ligne pour la fiche complète ; cliquez sur un titre de colonne pour trier.
        </p>
        <div className="controls">
          <input className="search" type="search" placeholder="Rechercher une action ou un investisseur" aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="dash-select" aria-label="Score minimum" value={min} onChange={(e) => setMin(Number(e.target.value))}>
            <option value={0}>Tous les scores</option><option value={1}>Score &gt; 0</option><option value={20}>Score ≥ 20</option><option value={40}>Score ≥ 40</option>
          </select>
        </div>
        <div className="scroll tall">
          <table>
            <thead><tr><th>Action</th>{COLS.map(th)}</tr></thead>
            <tbody>
              {err && <EmptyRow cols={11} text={`Classement indisponible (${err}).`} />}
              {!rows && !err && <EmptyRow cols={11} text="Calcul du classement…" />}
              {shown.map((r) => <FicheRow key={r.ticker} r={r} cols={11} />)}
              {rows && !shown.length && <EmptyRow cols={11} />}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>{rows ? `${shown.length} action(s) affichée(s) sur ${rows.length}.` : ""} Un score élevé signale un intérêt des investisseurs suivis, pas une recommandation d&apos;achat.</p>
      </div>
    </section>
  );
}
