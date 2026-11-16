"use client";
import { useEffect, useState } from "react";
import type { DashboardData } from "@tracker/core";
import { Header } from "./Header";
import { Tape } from "./Tape";
import { Footer } from "./Footer";
import { Alertes } from "./tabs/Alertes";
import { Fonds } from "./tabs/Fonds";
import { Ark } from "./tabs/Ark";
import { Inities } from "./tabs/Inities";
import { Trump } from "./tabs/Trump";
import { Congres } from "./tabs/Congres";
import { Classement } from "./tabs/Classement";

const TABS = [
  ["alertes", "Alertes récentes"],
  ["fonds", "Super-investisseurs"],
  ["ark", "Cathie Wood (ARK)"],
  ["inities", "Initiés & Musk"],
  ["trump", "Donald Trump"],
  ["congres", "Congrès US"],
  ["classement", "Classement"],
] as const;
type TabId = (typeof TABS)[number][0];

export function Dashboard({ data, today }: { data: DashboardData; today: string }) {
  const [tab, setTab] = useState<TabId>("alertes");
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash.slice(1);
      if (TABS.some(([id]) => id === h)) setTab(h as TabId);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const go = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };
  const first = data.operations[0];

  return (
    <div className="tk">
      <Header lastDate={first?.datePublication ?? null} lastWho={first ? first.qui.replace(/\s*\(.*\)$/, "") : null} />
      <Tape ops={data.operations} />
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => go(id)}>{label}</button>
        ))}
      </div>
      {tab === "alertes" && <Alertes data={data} />}
      {tab === "fonds" && <Fonds data={data} today={today} />}
      {tab === "ark" && <Ark data={data} />}
      {tab === "inities" && <Inities data={data} />}
      {tab === "trump" && <Trump data={data} />}
      {tab === "congres" && <Congres data={data} />}
      {tab === "classement" && <Classement />}
      <Footer />
    </div>
  );
}
