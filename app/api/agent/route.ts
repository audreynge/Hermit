import { runAgent } from "@/lib/agent/loop";
import { isLoopback, openaiClient } from "@/lib/llm/openai";
import { geminiClient } from "@/lib/llm/gemini";
import { listRuns, loadRun, newRunId, saveRun } from "@/lib/agent/replay";
import { loadRoomGraph, searchCandidates } from "@/lib/query/load";
import { loadSite } from "@/lib/neighborhood/load";
import { lookupZoning } from "@/lib/regs/zoning";
import { researchRegulations } from "@/lib/regs/research";
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
        const gemini = process.env.ANTHROPIC_API_KEY ? null : await geminiClient().catch((e) => (emit({ type: "error", id: "gemini", message: `Gemini unavailable (${e instanceof Error ? e.message : e}); planning deterministically.` }), null));
        const openai = process.env.ANTHROPIC_API_KEY || gemini ? null : await openaiClient(isLoopback(req)).catch(() => null);
        await runAgent(spec, emit, { shells: (s) => searchCandidates(s.city, s.mode === "home" ? ["home"] : ["business", "enterprise"]), graph: loadRoomGraph, site: loadSite, zoning: (lat, lon) => lookupZoning(lat, lon), research: (q) => researchRegulations(q) }, { gemini, openai });
      } catch (e) {
        emit({ type: "error", id: "fatal", message: e instanceof Error ? e.message : String(e) });
      }
      try {
        await saveRun(runId, spec, events);
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
  const run = await loadRun(asked) ?? (asked === "demo" || asked === "latest" ? await loadRun((await listRuns())[0]?.id ?? "") : null);
  if (!run) return Response.json({ error: "unknown run" }, { status: 404 });
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // Replays read only the recorded events (no provider calls), so they play the same with no network. The done
      // event keeps the run's original planner; the run event's replay: true is what marks it as a recording.
      try {
        controller.enqueue(enc.encode(sse({ type: "run", id: "run", runId: run.id, replay: true, spec: run.spec })));
        for (const e of run.events) {
          if (e.type === "run") continue;
          await new Promise((r) => setTimeout(r, e.type === "tool" ? 180 : 90));
          controller.enqueue(enc.encode(sse(e)));
        }
        controller.close();
      } catch {
        // client went away mid-replay
      }
    },
  });
  return new Response(stream, { headers });
}
