import Link from "next/link";
import { PacketPrint } from "@/components/report/PacketPrint";
import { loadRun } from "@/lib/agent/replay";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenant packet · Hermit" };

// Printable one-page packet. The owner's profile and furnished layout live in their browser, so this renders there.
export default async function PacketPage({ params }: { params: Promise<{ run: string; shell: string }> }) {
  const { run: runId, shell } = await params;
  const run = await loadRun(runId);
  const report = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])).find((r) => r.shellId === shell);
  if (!run || !report) return <p className="card pad">Packet not found on this server. <Link href="/">Start with Hermit</Link>.</p>;
  return <PacketPrint report={report} spec={run.spec} runId={run.id} />;
}
