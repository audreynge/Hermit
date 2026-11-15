"use client";
import { ArrowLeft, Box, FileSignature, Heart, LayoutDashboard, MessagesSquare, Plane } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { isSaved, toggleSaved } from "@/lib/client/persist";
import type { PlanStep } from "@/lib/crew/planner";
import type { SiteFile } from "@/lib/neighborhood/types";
import type { RequirementSpec, ShellReport, TraceEvent } from "@/lib/types";
import { Aerial } from "../Aerial";
import type { Proposal } from "../FitView";
import type { FurnishApi } from "../FurnishTour";
import type { FitoutOp } from "@/lib/design/fitout";
import { Broker } from "./Broker";
import { Inside } from "./Inside";
import { Lease } from "./Lease";
import { Overview } from "./Overview";
import { ReportChat } from "./ReportChat";

export type ReportCtx = {
  report: ShellReport; spec: RequirementSpec; runId: string; site: SiteFile | null; use: string;
  challenge: Extract<TraceEvent, { type: "challenge" }> | null; plan: { steps: PlanStep[]; total: [number, number] };
  go: (tab: TabId | string) => void;
  furnish: MutableRefObject<FurnishApi | null>; // set while the Inside tour is mounted
  fit: FitProposal | null; setFit: (p: FitProposal | null) => void; // the chat's latest fit-out proposal for this space
};
export type FitProposal = Omit<Proposal, "report"> & { report: ShellReport; ops: FitoutOp[] };
export type TabId = "overview" | "inside" | "aerial" | "lease" | "broker";

const TABS: { id: TabId; label: string; Icon: typeof Box }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "inside", label: "Inside", Icon: Box },
  { id: "aerial", label: "From above", Icon: Plane },
  { id: "lease", label: "Lease coach", Icon: FileSignature },
  { id: "broker", label: "Talk to your broker", Icon: MessagesSquare },
];
const LEGACY: Record<string, TabId> = { rules: "overview", money: "overview", questions: "broker", packet: "broker", neighborhood: "aerial", furnish: "inside" };
const toTab = (t?: string | null): TabId => (t && (LEGACY[t] ?? TABS.find((x) => x.id === t)?.id)) || "overview";
function Above({ report }: ReportCtx) {
  return (
    <section className="card pad aerial-section" aria-label="Aerial view">
      <div className="aerial-frame"><Aerial report={report} /></div>
      <p className="muted small">Photos © Vexcel Imaging (Esri World Imagery where Vexcel has none), centered on the record&apos;s coordinates.</p>
    </section>
  );
}
const PANELS = { overview: Overview, inside: Inside, aerial: Above, lease: Lease, broker: Broker };

export function ShellReportPage(props: Omit<ReportCtx, "go" | "furnish" | "fit" | "setFit"> & { initialTab?: string }) {
  const { report, runId, spec } = props;
  // The URL is the source of truth so links and go() (replaceState) both switch tabs.
  const params = useSearchParams();
  const tab = toTab(params.get("tab") ?? props.initialTab);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(isSaved(report.shellId)); }, [report.shellId]);
  const go = (t: TabId | string) => { window.scrollTo({ top: 0 }); history.replaceState(null, "", `?run=${runId}&tab=${toTab(t)}`); };
  const furnish = useRef<FurnishApi | null>(null);
  const [fit, setFit] = useState<FitProposal | null>(null);
  const ctx: ReportCtx = { ...props, go, furnish, fit, setFit };
  const Panel = PANELS[tab];
  const labelFor = (id: TabId, label: string) => (id === "broker" && spec.mode === "home" ? "Talk to the landlord" : label);
  return (
    <article className="shell-page">
      <header className="shell-head">
        <div>
          <p className="back"><Link href="/studio"><ArrowLeft aria-hidden="true" className="inline-icon" /> See other matches</Link></p>
          <h1>{report.name}</h1>
          <p className="muted">{report.address || "Address not in the index"}{report.sqft ? ` · ${report.sqft.toLocaleString()} sf` : ""}
            {" "}<span className={`stamp-inline small ${report.badge === "scan-verified" ? "ok" : "rec"}`}>{report.badge === "scan-verified" ? "Scan-verified" : "Record-only"}</span></p>
        </div>
        <button type="button" className="btn" aria-pressed={saved} onClick={() => setSaved(toggleSaved(report, runId))}><Heart aria-hidden="true" fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}</button>
      </header>
      <nav className="report-tabs" role="tablist" aria-label="Shell Report sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} aria-controls="report-panel" onClick={() => go(id)}><Icon aria-hidden="true" /> {labelFor(id, label)}</button>
        ))}
      </nav>
      <section id="report-panel" role="tabpanel" aria-label={labelFor(tab, TABS.find((t) => t.id === tab)!.label)} className="report-panel"><Panel {...ctx} /></section>
      <p className="muted small report-foot">Screening only: Hermit doesn&apos;t inspect, certify code status or promise availability.</p>
      <ReportChat {...ctx} tab={tab} />
    </article>
  );
}
