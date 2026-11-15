"use client";
import { ArrowLeft, Box, FileSignature, Heart, LayoutDashboard, MapPinned, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { tidyReport } from "@/lib/agent/report";
import { isSaved, toggleSaved } from "@/lib/client/persist";
import { sizeText } from "@/lib/uses/rooms";
import type { PlanStep } from "@/lib/crew/planner";
import type { SiteFile } from "@/lib/neighborhood/types";
import type { RequirementSpec, ShellReport, TraceEvent } from "@/lib/types";
import { Broker } from "./Broker";
import { InsideFurnish } from "./InsideFurnish";
import { Lease } from "./Lease";
import { Neighborhood } from "./Neighborhood";
import { Overview } from "./Overview";
import { ReportChat } from "./ReportChat";

export type ReportCtx = {
  report: ShellReport; spec: RequirementSpec; runId: string; site: SiteFile | null; use: string;
  challenge: Extract<TraceEvent, { type: "challenge" }> | null; plan: { steps: PlanStep[]; total: [number, number] };
  go: (tab: TabId | string) => void;
};
export type TabId = "overview" | "inside" | "neighborhood" | "lease" | "broker";

const TABS: { id: TabId; label: string; Icon: typeof Box }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "inside", label: "Inside & furnish", Icon: Box },
  { id: "neighborhood", label: "Neighborhood", Icon: MapPinned },
  { id: "lease", label: "Lease coach", Icon: FileSignature },
  { id: "broker", label: "Talk to your broker", Icon: MessagesSquare },
];
const LEGACY: Record<string, TabId> = { furnish: "inside", rules: "overview", money: "overview", questions: "broker", packet: "broker" };
const toTab = (t?: string | null): TabId => (t && (LEGACY[t] ?? TABS.find((x) => x.id === t)?.id)) || "overview";
const PANELS = { overview: Overview, inside: InsideFurnish, neighborhood: Neighborhood, lease: Lease, broker: Broker };

export function ShellReportPage(props: Omit<ReportCtx, "go"> & { initialTab?: string }) {
  const { runId, spec, plan } = props;
  // Older recorded runs: drop questions the scan photos already answered and repeats, and use the opening plan's weeks
  // (the same number the cards and the chat show).
  const report = useMemo(() => ({ ...tidyReport(props.report, spec), weeksToOpen: plan.total }), [props.report, spec, plan.total]);
  // The URL is the source of truth so links and go() (replaceState) both switch tabs.
  const params = useSearchParams();
  const tab = toTab(params.get("tab") ?? props.initialTab);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(isSaved(report.shellId)); }, [report.shellId]);
  const go = (t: TabId | string) => { window.scrollTo({ top: 0 }); history.replaceState(null, "", `?run=${runId}&tab=${toTab(t)}`); };
  const ctx: ReportCtx = { ...props, report, go };
  const size = sizeText(report);
  const Panel = PANELS[tab];
  const labelFor = (id: TabId, label: string) => (id === "broker" && spec.mode === "home" ? "Talk to the landlord" : label);
  return (
    <article className="shell-page">
      <header className="shell-head">
        <div>
          <p className="back"><Link href="/studio"><ArrowLeft aria-hidden="true" className="inline-icon" /> See other matches</Link></p>
          <h1>{report.name}</h1>
          <p className="muted">{report.address || "Address not in the index"}{size ? ` · ${size}` : ""}
            {" "}<span className={`stamp-inline small ${report.badge === "scan-verified" ? "ok" : "rec"}`}>{report.badge === "scan-verified" ? "3D scan" : "Records only"}</span></p>
        </div>
        <button type="button" className="btn" aria-pressed={saved} onClick={() => setSaved(toggleSaved(report, runId))}><Heart aria-hidden="true" fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}</button>
      </header>
      <nav className="report-tabs" role="tablist" aria-label="Shell Report sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} aria-controls="report-panel" onClick={() => go(id)}><Icon aria-hidden="true" /> {labelFor(id, label)}</button>
        ))}
      </nav>
      <section id="report-panel" role="tabpanel" aria-label={labelFor(tab, TABS.find((t) => t.id === tab)!.label)} className="report-panel"><Panel {...ctx} /></section>
      <ReportChat report={report} spec={spec} runId={runId} tab={tab} />
    </article>
  );
}
