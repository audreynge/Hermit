import Link from "next/link";
import { ShellReportPage } from "@/components/report/ShellReportPage";
import { openingPlan } from "@/lib/crew/planner";
import { loadRun } from "@/lib/agent/replay";
import { enrichSite } from "@/lib/neighborhood/build";
import { loadSite } from "@/lib/neighborhood/load";
import { useCategory } from "@/lib/reason/rules";
import { loadAerialCount } from "@/lib/vexcel/count";
import { loadPanoChecks } from "@/lib/vision/pano";
import type { TraceEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ShellPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; tab?: string }> }) {
  const { id } = await params;
  const { run: runId, tab } = await searchParams;
  const run = await loadRun(runId ?? "");
  const found = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])).find((r) => r.shellId === id);
  if (!run || !found) return <p className="card pad">This Shell Report isn&apos;t on this server (it may come from another machine). <Link href="/studio">Start a search</Link>.</p>;
  // Runs recorded before the aerial count and the scan-photo checks existed: fill them from the cached files, so every
  // report shows what was counted or seen. Missing files stay missing (null = not counted, never zero). A newer run's
  // own checks (only the rooms it looked at) win; the cached ones fill the other rooms.
  const sid = found.inside?.sid;
  const own = found.checks ?? [];
  const key = (c: { roomId: string; feature: string }) => `${c.roomId}|${c.feature.toLowerCase()}`;
  const have = new Set(own.map(key));
  const checks = [...own, ...(sid ? loadPanoChecks(sid).filter((c) => !have.has(key(c))) : [])];
  const report = { ...found, aerial: found.aerial ?? loadAerialCount(sid ?? found.shellId) ?? undefined, checks: checks.length ? checks : undefined };
  // Prefetched neighborhood file when the scan has one; gaps (or the whole file) filled from the cached city layers.
  const site = enrichSite(report.inside?.sid ? loadSite(report.inside.sid) : null, report.above?.lat, report.above?.lon, run.spec.city);
  const challenge = run.events.find((e): e is Extract<TraceEvent, { type: "challenge" }> => e.type === "challenge" && e.shellId === id) ?? null;
  const plan = openingPlan(run.spec, report);
  return <ShellReportPage report={report} spec={run.spec} runId={run.id} site={site} challenge={challenge} plan={plan} use={useCategory(run.spec.useType)} initialTab={tab} />;
}
