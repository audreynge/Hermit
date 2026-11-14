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
      { stop_reason: "tool_use", content: [toolUse("t2", "evaluate_candidates", { shellIds: ["S1", "S2"] }), toolUse("t3", "drop_candidate", { drops: [{ shellId: "S3", reason: "test" }] })] },
      { stop_reason: "tool_use", content: [toolUse("t4", "submit_reports", { shellIds: ["S2", "S1"] })] },
    ]);
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec, (e) => events.push(e), deps, { client });

    expect(reports.map((r) => r.shellId)).toEqual(["S2", "S1"]);
    const third = calls[2].messages.at(-1)!;
    expect(third.role).toBe("user");
    expect((third.content as { tool_use_id: string }[]).map((b) => b.tool_use_id)).toEqual(["t2", "t3"]);
    expect(events.find((e) => e.type === "plan")).toMatchObject({ text: "Searching first." });
    expect(events.find((e) => e.type === "drop")).toMatchObject({ shellId: "S3" });
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

  it("enforces the tool-call budget inside a single model turn and still reports", async () => {
    const many = Array.from({ length: 30 }, (_, i) => toolUse(`s${i}`, "search_shells", {}));
    const { client } = fakeClient([
      { stop_reason: "tool_use", content: many },
      { stop_reason: "tool_use", content: [toolUse("x", "search_shells", {})] },
    ]);
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec, (e) => events.push(e), deps, { client });
    const done = events.at(-1) as Extract<TraceEvent, { type: "done" }>;
    expect(done.toolCalls).toBeLessThanOrEqual(26);
    expect(reports.length).toBeGreaterThan(0);
  });

  it("rejects submit ids that were never evaluated and drops of unknown ids", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [toolUse("t1", "search_shells", {})] },
      { stop_reason: "tool_use", content: [toolUse("t2", "drop_candidate", { drops: [{ shellId: "MADE_UP", reason: "x" }] })] },
      { stop_reason: "tool_use", content: [toolUse("t3", "submit_reports", { shellIds: ["S1"] })] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ]);
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec, (e) => events.push(e), deps, { client });
    expect(calls[2].messages.at(-1)!.content).toMatchObject([{ tool_use_id: "t2", is_error: true }]);
    expect(calls[3].messages.at(-1)!.content).toMatchObject([{ tool_use_id: "t3", is_error: true }]);
    expect(events.some((e) => e.type === "drop")).toBe(false);
    expect(reports.length).toBeGreaterThan(0);
  });

  it("attaches regulations even when the Claude planner never calls the research tool", async () => {
    const { client } = fakeClient([
      { stop_reason: "tool_use", content: [toolUse("t1", "search_shells", {})] },
      { stop_reason: "tool_use", content: [toolUse("t2", "evaluate_candidates", { shellIds: ["S1"] })] },
      { stop_reason: "tool_use", content: [toolUse("t3", "submit_reports", { shellIds: ["S1"] })] },
    ]);
    const research = async () => ({ fromCache: false, findings: [{ topic: "occupancy" as const, jurisdiction: "city" as const, requirement: "CO", appliesWhen: "x", certainty: "applies" as const, url: "https://houstontx.gov/co", citedText: "c", retrievedAt: "2026-11-14" }] });
    const reports = await runAgent(spec, () => {}, { ...deps, research }, { client });
    expect(reports[0].rules.some((h) => h.rule === "reg_occupancy")).toBe(true);
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
