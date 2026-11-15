import Link from "next/link";
import { ShellReportPage } from "@/components/report/ShellReportPage";
import { openingPlan } from "@/lib/crew/planner";
import { loadRun } from "@/lib/agent/replay";
import { loadSite } from "@/lib/neighborhood/load";
import { useCategory } from "@/lib/reason/rules";
import type { TraceEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ShellPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; tab?: string }> }) {
  const { id } = await params;
  const { run: runId, tab } = await searchParams;
  const run = await loadRun(runId ?? "");
  const report = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])).find((r) => r.shellId === id);
  if (!run || !report) return <p className="card pad">This Shell Report isn&apos;t on this server (it may come from another machine). <Link href="/studio">Start a search</Link>.</p>;
  const site = report.inside?.sid ? loadSite(report.inside.sid) : null;
  const challenge = run.events.find((e): e is Extract<TraceEvent, { type: "challenge" }> => e.type === "challenge" && e.shellId === id) ?? null;
  const plan = openingPlan(run.spec, report);
  return <ShellReportPage report={report} spec={run.spec} runId={run.id} site={site} challenge={challenge} plan={plan} use={useCategory(run.spec.useType)} initialTab={tab} />;
}
