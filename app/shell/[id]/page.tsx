import Link from "next/link";
import { ReportPanel } from "@/components/ReportPanel";
import { FitView } from "@/components/FitView";
import { loadRun } from "@/lib/agent/replay";

export const dynamic = "force-dynamic";

export default async function ShellPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string }> }) {
  const { id } = await params;
  const { run: runId } = await searchParams;
  const run = loadRun(runId ?? "");
  const report = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])).find((r) => r.shellId === id);
  if (!run || !report) return <p>Report not found. It may have come from a run on another server. <Link href="/plan">Start a search</Link>.</p>;
  return (
    <div className="stack" style={{ maxWidth: 900, margin: "0 auto" }}>
      <p className="muted no-print"><Link href={`/results?replay=${run.id}`}>← Back to results</Link> · Search for a {run.spec.useType}, run {new Date(run.createdAt).toLocaleString()}</p>
      <ReportPanel report={report} runId={run.id} printable />
      <section className="card"><h2>Fit overlay</h2><FitView report={report} /></section>
      <p className="muted">Hermit is a screening tool. It doesn&apos;t inspect, certify code compliance or guarantee availability.</p>
    </div>
  );
}
