import { loadRun } from "@/lib/agent/replay";
import { getShell } from "@/lib/query/load";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await loadRun(new URL(req.url).searchParams.get("run") ?? "");
  const report = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])).find((r) => r.shellId === id);
  if (report) return Response.json({ report, spec: run!.spec });
  const shell = getShell(id);
  return shell ? Response.json({ shell }) : Response.json({ error: "not found" }, { status: 404 });
}
