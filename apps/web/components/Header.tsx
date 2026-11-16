"use client";
import { useEffect, useState } from "react";
import { fmtDate } from "@/lib/format";

const fmt = (tz: string, d: Date) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);

function nyseOpen(d: Date): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function Header({ lastDate, lastWho }: { lastDate: string | null; lastWho: string | null }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const clk = (tz: string) => (now ? fmt(tz, now) : "--:--:--");
  const open = now ? nyseOpen(now) : null;
  return (
    <header className="hero">
      <p className="kicker">LIVE · déclarations officielles SEC · OGE · Congrès</p>
      <div className="statusbar" aria-label="Horloges">
        <span>UTC <span className="clk">{clk("UTC")}</span></span>
        <span>New York <span className="clk">{clk("America/New_York")}</span></span>
        <span>Paris <span className="clk">{clk("Europe/Paris")}</span></span>
        <span className={`mkt ${open ? "open" : "closed"}`}>
          NYSE · {open == null ? "…" : open ? "Ouvert" : "Fermé"}
        </span>
      </div>
      <h1>Ce que les grands investisseurs achètent et vendent</h1>
      <p className="lead">
        Buffett, Musk, Cathie Wood, Trump, les élus du Congrès… Dernière publication captée le <b>{fmtDate(lastDate)}</b>
        {lastWho ? <> (<b>{lastWho}</b>)</> : null}. Les initiés et ARK sont publiés en un à deux jours ; les fonds (13F), Trump et
        les élus le sont jusqu&apos;à 45 jours après coup.
      </p>
    </header>
  );
}
