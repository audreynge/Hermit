import { describe, expect, it } from "vitest";
import { runAgent } from "../agent/loop";
import type { GeminiContent } from "./gemini";
import type { RequirementSpec, Shell, TraceEvent } from "../types";

const spec: RequirementSpec = { mode: "business", city: "houston", useType: "office", rooms: [], needs: {}, priorities: {}, input: "text" };
const shells = [1, 2].map((i): Shell => ({
  id: `S${i}`, mode: "business", city: "houston", name: `S${i}`, address: "x", propertyType: "Office", subtype: "Unknown",
  useTags: ["office"], sprinkler: "unknown", heavyPower: null, driveInBays: null, loadingDocks: null, parkingSpaces: null, zoning: null, elevator: null,
}));
const fc = (id: string, name: string, args: Record<string, unknown>) => ({ functionCall: { id, name, args }, thoughtSignature: `sig-${id}` });

describe("gemini planner loop", () => {
  it("runs function calls through the tool registry and echoes model turns back verbatim", async () => {
    const turns: GeminiContent[] = [
      { role: "model", parts: [{ text: "thinking", thought: true }, { text: "Searching first." }, fc("a", "search_shells", {})] },
      { role: "model", parts: [fc("b", "evaluate_candidates", { shellIds: ["S1", "S2"] })] },
      { role: "model", parts: [fc("c", "submit_reports", { shellIds: ["S1"] })] },
    ];
    const seen: GeminiContent[][] = [];
    const gemini = { model: "m", generate: async (b: Record<string, unknown>) => { seen.push(structuredClone(b.contents as GeminiContent[])); return turns.shift()!; } };
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec, (e) => events.push(e), { shells: () => shells, graph: () => null }, { client: null, gemini });
    expect(reports.map((r) => r.shellId)).toEqual(["S1"]);
    expect(seen[1].at(-2)!.parts.at(-1)).toMatchObject({ thoughtSignature: "sig-a" });
    expect(seen[1].at(-1)).toMatchObject({ role: "user", parts: [{ functionResponse: { id: "a", name: "search_shells" } }] });
    expect(events.find((e) => e.type === "plan")).toMatchObject({ text: "Searching first." });
    expect(events.at(-1)).toMatchObject({ type: "done", planner: "gemini" });
  });
});
