import { z } from "zod";
import { loadRoomGraph, searchCandidates } from "@/lib/query/load";
import { drawnArea, similarScans } from "@/lib/similarity/layout";
import { City, Mode, RequirementSpec } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({
  // Tighter than the spec schema: Hungarian cost grows with block count, and this runs on every edit.
  layout: z.array(z.object({ label: z.string().max(40), x: z.number().min(0).max(1000), y: z.number().min(0).max(1000), w: z.number().positive().max(500), h: z.number().positive().max(500) })).min(1).max(40),
  city: City,
  mode: Mode.default("business"),
  scale: z.number().min(0.25).max(4).default(1),
  limit: z.number().int().min(1).max(12).default(6),
});

// Live preview for the layout studio: pure geometry ranking, no agent run. The full agentic search runs from /api/agent.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const { layout, city, mode, scale, limit } = parsed.data;
  const drawn = drawnArea(layout);
  const spec = RequirementSpec.parse({ mode, city, useType: "office", input: "layout", layout, ...(drawn ? { sizeSqft: [drawn * scale, drawn * scale * 2] } : {}) });
  const { results } = similarScans(spec, searchCandidates(city, mode === "home" ? ["home"] : ["business", "enterprise"]), loadRoomGraph);
  return Response.json({
    compared: results.length,
    results: results.slice(0, limit).map(({ candidate: { shell }, sim }) => {
      const g = loadRoomGraph(shell.sid!);
      return {
        shellId: shell.id, sid: shell.sid, name: shell.name, address: shell.address, sqft: shell.sqft, similarity: { ...sim, layout: undefined },
        floorplan: g && { sid: g.sid, name: g.name, totalAreaSqft: g.totalAreaSqft, rooms: g.rooms.map(({ id, label, polygon, heightFt, floorId, areaSqft }) => ({ id, label, polygon, heightFt, floorId, areaSqft, rawTags: [] })), edges: [], objects: [], panoCount: g.panoCount, floorCount: g.floorCount },
      };
    }),
  });
}
