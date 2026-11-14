"use client";
import { ArrowLeft, Banknote, Box, ClipboardCheck, Compass, FileSignature, Heart, HelpCircle, LayoutDashboard, MapPinned, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isSaved, toggleSaved } from "@/lib/client/persist";
import type { PlanStep } from "@/lib/crew/planner";
import type { SiteFile } from "@/lib/neighborhood/types";
import type { RequirementSpec, ShellReport, TraceEvent } from "@/lib/types";
import { ScoreRing } from "../studio/Postcard";
import { Furnish } from "./Furnish";
import { Inside } from "./Inside";
import { Lease } from "./Lease";
import { Money } from "./Money";
import { Neighborhood } from "./Neighborhood";
import { Overview } from "./Overview";
import { Packet } from "./Packet";
import { Questions } from "./Questions";
import { RulesTab } from "./RulesTab";

export type ReportCtx = {
  report: ShellReport; spec: RequirementSpec; runId: string; site: SiteFile | null; use: string;
  challenge: Extract<TraceEvent, { type: "challenge" }> | null; plan: { steps: PlanStep[]; total: [number, number] };
  go: (tab: TabId) => void;
};
export type TabId = "overview" | "inside" | "furnish" | "neighborhood" | "money" | "lease" | "rules" | "questions" | "packet";

const TABS: { id: TabId; label: string; Icon: typeof Box }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "inside", label: "Inside", Icon: Box },
  { id: "furnish", label: "Furnish", Icon: Compass },
  { id: "neighborhood", label: "Neighborhood", Icon: MapPinned },
  { id: "money", label: "Money", Icon: Banknote },
  { id: "lease", label: "Lease", Icon: FileSignature },
  { id: "rules", label: "Rules & access", Icon: ClipboardCheck },
  { id: "questions", label: "Questions", Icon: HelpCircle },
  { id: "packet", label: "Broker packet", Icon: Send },
];

export function ShellReportPage(props: Omit<ReportCtx, "go"> & { initialTab?: string }) {
  const { report, runId } = props;
  const [tab, setTab] = useState<TabId>((TABS.find((t) => t.id === props.initialTab)?.id) ?? "overview");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(isSaved(report.shellId)); }, [report.shellId]);
  const go = (t: TabId) => { setTab(t); window.scrollTo({ top: 0 }); history.replaceState(null, "", `?run=${runId}&tab=${t}`); };
  const ctx: ReportCtx = { ...props, go };
  const Panel = { overview: Overview, inside: Inside, furnish: Furnish, neighborhood: Neighborhood, money: Money, lease: Lease, rules: RulesTab, questions: Questions, packet: Packet }[tab];
  return (
    <article className="shell-page">
      <p className="back"><Link href="/studio"><ArrowLeft aria-hidden="true" className="inline-icon" /> Back to your search</Link></p>
      <header className="shell-head">
        <div>
          <p className="eyebrow">Shell Report #{report.rank} · <span className={`stamp-inline ${report.badge === "scan-verified" ? "ok" : "rec"}`}>{report.badge === "scan-verified" ? "Scan-verified" : "Record-only"}</span></p>
          <h1>{report.name}</h1>
          <p className="muted">{report.address || "Address not in the index"}{report.sqft ? ` · ${report.sqft.toLocaleString()} sf` : ""}</p>
        </div>
        <button type="button" className="btn" aria-pressed={saved} onClick={() => setSaved(toggleSaved(report, runId))}><Heart aria-hidden="true" fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}</button>
        <ScoreRing value={report.matchScore} size={64} />
      </header>
      <nav className="report-tabs" role="tablist" aria-label="Shell Report sections">
        {TABS.filter((t) => props.spec.mode !== "home" || !["money", "packet"].includes(t.id)).map(({ id, label, Icon }) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} aria-controls="report-panel" onClick={() => go(id)}><Icon aria-hidden="true" /> {label}</button>
        ))}
      </nav>
      <section id="report-panel" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label} className="report-panel"><Panel {...ctx} /></section>
    </article>
  );
}
