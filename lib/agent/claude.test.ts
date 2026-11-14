import { describe, expect, it } from "vitest";
import { runAgent } from "./loop";
import type { RequirementSpec, Shell, TraceEvent } from "../types";

const spec: RequirementSpec = { mode: "business", city: "houston", useType: "office", rooms: [], needs: {}, priorities: {}, input: "text" };
const shells = [1, 2, 3].map((i): Shell => ({
  id: `S${i}`, mode: "business", city: "houston", name: `S${i}`, address: "x", propertyType: "Office", subtype: "Unknown",
  useTags: ["office"], sprinkler: "unknown", heavyPower: null, driveInBays: null, loadingDocks: null, parkingSpaces: null, zoning: null, elevator: null,
}));
const deps = { shells: () => shells, graph: () => null };

type Call = { messages: { role: string; content: unknown }[] };

function fakeClient(turns: { content: unknown[]; stop_reason: string }[]) {
  const calls: Call[] = [];
  const client = {
    beta: { messages: { create: async (req: Call) => { calls.push(structuredClone(req)); const t = turns.shift(); if (!t) throw new Error("no more turns"); return t; } } },
  };
  return { client: client as never, calls };
}

const toolUse = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });

describe("claude planner loop", () => {
  it("executes parallel tool uses and returns all results in one user message", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "text", text: "Searching first." }, toolUse("t1", "search_shells", {})] },
      { stop_reason: "tool_use", content: [toolUse("t2", "evaluate_candidates", { shellIds: ["S1", "S2"] }), toolUse("t3", "drop_candidate", { shellId: "S3", reason: "test" })] },
      { stop_reason: "tool_use", content: [toolUse("t4", "submit_reports", { shellIds: ["S2", "S1"] })] },
    ]);
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec, (e) => events.push(e), deps, { client });

    expect(reports.map((r) => r.shellId)).toEqual(["S2", "S1"]);
    const third = calls[2].messages.at(-1)!;
    expect(third.role).toBe("user");
    expect((third.content as { tool_use_id: string }[]).map((b) => b.tool_use_id)).toEqual(["t2", "t3"]);
    expect(events.find((e) => e.type === "plan")).toMatchObject({ text: "Searching first." });
    expect(events.at(-1)).toMatchObject({ type: "done", planner: "claude" });
  });

  it("reports a bad tool call back to the model as an error result", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [toolUse("t1", "no_such_tool", {})] },
      { stop_reason: "tool_use", content: [toolUse("t2", "search_shells", {})] },
      { stop_reason: "tool_use", content: [toolUse("t3", "evaluate_candidates", { shellIds: ["S1"] })] },
      { stop_reason: "tool_use", content: [toolUse("t4", "submit_reports", { shellIds: ["S1"] })] },
    ]);
    await runAgent(spec, () => {}, deps, { client });
    expect(calls[1].messages.at(-1)!.content).toMatchObject([{ tool_use_id: "t1", is_error: true }]);
  });

  it("finishes deterministically when the API fails", async () => {
    const { client } = fakeClient([]);
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec, (e) => events.push(e), deps, { client });
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", planner: "deterministic" });
    expect(reports.length).toBeGreaterThan(0);
  });
});
