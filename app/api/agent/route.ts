import { runAgent } from "@/lib/agent/loop";
import { listRuns, loadRun, newRunId, saveRun } from "@/lib/agent/replay";
import { loadRoomGraph, loadShells } from "@/lib/query/load";
import { loadSite } from "@/lib/neighborhood/load";
import { RequirementSpec, type TraceEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const sse = (e: TraceEvent) => `data: ${JSON.stringify(e)}\n\n`;
const headers = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" };

export async function POST(req: Request) {
  const parsed = RequirementSpec.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const spec = parsed.data;
  const runId = newRunId();
  const events: TraceEvent[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (e: TraceEvent) => {
        events.push(e);
        try {
          controller.enqueue(enc.encode(sse(e)));
        } catch {
          // client went away; keep recording so the run can still be replayed
        }
      };
      emit({ type: "run", id: "run", runId, replay: false });
      try {
        await runAgent(spec, emit, { shells: loadShells, graph: loadRoomGraph, site: loadSite });
      } catch (e) {
        emit({ type: "error", id: "fatal", message: e instanceof Error ? e.message : String(e) });
      }
      try {
        saveRun(runId, spec, events);
      } catch {
        // read-only filesystem (e.g. serverless): replay of this run is unavailable
      }
      try { controller.close(); } catch {}
    },
  });
  return new Response(stream, { headers });
}

export async function GET(req: Request) {
  const asked = new URL(req.url).searchParams.get("replay") ?? "";
  const run = loadRun(asked) ?? (asked === "demo" || asked === "latest" ? loadRun(listRuns()[0]?.id ?? "") : null);
  if (!run) return Response.json({ error: "unknown run" }, { status: 404 });
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(sse({ type: "run", id: "run", runId: run.id, replay: true, spec: run.spec })));
      for (const e of run.events) {
        if (e.type === "run") continue;
        await new Promise((r) => setTimeout(r, e.type === "tool" ? 180 : 90));
        controller.enqueue(enc.encode(sse(e.type === "done" ? { ...e, planner: "replay" } : e)));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers });
}
