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
  if (!run || !report) return <p>Report not found. It may have come from a run on another server. <Link href="/">Start a search</Link>.</p>;
  return (
    <div style={{ maxWidth: 940, margin: "0 auto", display: "grid", gap: 18 }}>
      <p className="muted no-print"><Link href="/">← Back to Hermit</Link> · Search for a {run.spec.useType}, run {new Date(run.createdAt).toLocaleString()}</p>
      <section className="card panel"><h1 style={{ fontSize: 34, marginBottom: 8 }}>{report.name.split(" · ")[0]}</h1><ReportPanel report={report} runId={run.id} printable /></section>
      <section className="card panel"><h2 style={{ fontSize: 24 }}>Fit overlay</h2><FitView report={report} /></section>
    </div>
  );
}
