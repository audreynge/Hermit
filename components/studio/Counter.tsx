"use client";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useSettings } from "@/lib/client/settings";
import type { FunnelStage } from "@/lib/types";

export type Extra = { key: string; label: string; count: number; removed?: FunnelStage["removed"]; tone?: "veto" };

// Plain-language versions of each funnel step. The technical labels stay one setting away.
function friendly(key: string, label: string, useLabel: string): { label: string; why: string } {
  switch (key) {
    case "indexed": return { label: "shells on the beach", why: "Every scanned space Hermit knows about." };
    case "city": return { label: label.replace(/^in /, "in "), why: "Set aside because they're in another city." };
    case "type": return { label: /homes/.test(label) ? "homes" : /industrial/.test(label) ? "industrial spaces" : "places to do business", why: "Set aside: apartments, pools, gyms and lobbies." };
    case "size": return { label: "the right size", why: "Set aside because they're much too big or too small." };
    case "use": return { label: `already set up for a ${useLabel}`, why: `Set aside because they were built for something very different.` };
    case "beds": return { label: "enough bedrooms", why: "Set aside: not enough bedrooms." };
    case "veto": return { label, why: "My crew crawled inside and found a dealbreaker." };
    default: return { label, why: "" };
  }
}

export function Counter({ stages, extra = [], useLabel = "space" }: { stages: FunnelStage[]; extra?: Extra[]; useLabel?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const { tech } = useSettings();
  const all = [...stages.map((s) => ({ key: s.key, label: s.label, count: s.count, removed: s.removed, removedCount: s.removedCount, tone: undefined as Extra["tone"] })), ...extra];
  if (!all.length) return <div className="counter" />;
  const opened = all.find((s) => s.key === open);
  const shown = (s: (typeof all)[number]) => (tech ? { label: s.label, why: "" } : friendly(s.key, s.label, useLabel));
  return (
    <div className="counter" aria-label="How many spaces are left">
      <ol>
        {all.map((s, i) => (
          <li key={s.key}>
            {i > 0 && <ChevronRight aria-hidden="true" className="counter-arrow" />}
            <button type="button" className="counter-step" data-tone={s.tone} data-last={i === all.length - 1}
              aria-expanded={open === s.key} disabled={!s.removed?.length} onClick={() => setOpen(open === s.key ? null : s.key)}>
              <strong className="num">{s.count.toLocaleString()}</strong> <span>{shown(s).label}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">{all.at(-1)!.count.toLocaleString()} {shown(all.at(-1)!).label}</p>
      {opened?.removed?.length ? (
        <div className="whynot" role="region" aria-label="Why some spaces were set aside">
          <p>{tech ? <><strong>Removed at “{opened.label}”.</strong> Showing {opened.removed.length}.</> : <><strong>{friendly(opened.key, opened.label, useLabel).why}</strong> For example:</>}</p>
          <ul>{opened.removed.slice(0, tech ? 25 : 5).map((r) => <li key={r.id}><span className="whynot-name">{r.name}</span>{(tech || opened.tone === "veto") && ` ${plain(r.reason, tech)}`}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

// Turn a specialist's reason into something a person would say.
export function plain(reason: string, tech = false): string {
  if (tech) return reason;
  let m;
  if ((m = reason.match(/Measured area (\d+) sf is far below the (\d+) sf/))) return `it measured only ${Number(m[1]).toLocaleString()} sf inside, much smaller than you need.`;
  if ((m = reason.match(/spans (\d+) floors/))) return `it's split over ${m[1]} levels with no elevator in sight.`;
  if ((m = reason.match(/about (\d+) in clear/))) return `the hallway is only about ${m[1]} inches wide, too tight for a wheelchair.`;
  if (/bathroom not found/i.test(reason)) return "there's no restroom anywhere in the scan.";
  if (/zon/i.test(reason)) return "local zoning doesn't look friendly to your use.";
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}
