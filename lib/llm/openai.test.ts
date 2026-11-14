import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../db";
import { authorizeUrl, completeSignIn, isLoopback, readStream } from "./openai";
import { runAgent } from "../agent/loop";
import type { RequirementSpec, Shell, TraceEvent } from "../types";

const sse = (...events: object[]) => new Response(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("")).body!;

beforeEach(() => {
  process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-oa-")), "hermit.db");
  closeDb();
});

describe("openai responses stream", () => {
  it("returns the completed response and rejects failed ones", async () => {
    expect(await readStream(sse({ type: "response.output_text.delta", delta: "hi" }, { type: "response.completed", response: { output: [{ type: "message" }] } })))
      .toEqual({ output: [{ type: "message" }] });
    await expect(readStream(sse({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }))).rejects.toThrow(/usage_limit/);
    await expect(readStream(sse({ type: "response.output_text.delta", delta: "x" }))).rejects.toThrow(/before response.completed/);
  });
});

describe("sign in with ChatGPT", () => {
  it("only treats direct local requests as loopback", () => {
    expect(isLoopback(new Request("http://127.0.0.1:3100/x"))).toBe(true);
    expect(isLoopback(new Request("http://localhost:3100/x", { headers: { host: "127.0.0.1:3100", "x-forwarded-for": "::ffff:127.0.0.1" } }))).toBe(true);
    expect(isLoopback(new Request("http://localhost:3100/x", { headers: { "x-forwarded-for": "1.2.3.4" } }))).toBe(false);
    expect(isLoopback(new Request("http://localhost:3100/x", { headers: { host: "abc.ngrok.app" } }))).toBe(false);
    expect(isLoopback(new Request("https://abc.ngrok.app/x"))).toBe(false);
  });

  it("registers dynamically with PKCE, a stable host id and a 127.0.0.1 callback", () => {
    const u = new URL(authorizeUrl(new Request("http://localhost:3100/api/auth/openai/start")));
    const q = u.searchParams;
    expect(u.origin + u.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:3100/api/auth/openai/callback");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("scope")).toContain("chatgpt.tokens.use.direct");
    const host = q.get("ext_agent_host_id");
    expect(host).toMatch(/^urn:uuid:/);
    expect(new URL(authorizeUrl(new Request("http://127.0.0.1:3100/s"))).searchParams.get("ext_agent_host_id")).toBe(host);
  });

  it("rejects a callback whose state does not match", async () => {
    authorizeUrl(new Request("http://127.0.0.1:3100/s"));
    await expect(completeSignIn(new URLSearchParams({ state: "forged", code: "c", client_id: "app_1" }))).rejects.toThrow(/expired|did not start/);
  });
});

describe("openai planner loop", () => {
  const spec: RequirementSpec = { mode: "business", city: "houston", useType: "office", rooms: [], needs: {}, priorities: {}, input: "text" };
  const shells = [1, 2].map((i): Shell => ({
    id: `S${i}`, mode: "business", city: "houston", name: `S${i}`, address: "x", propertyType: "Office", subtype: "Unknown",
    useTags: ["office"], sprinkler: "unknown", heavyPower: null, driveInBays: null, loadingDocks: null, parkingSpaces: null, zoning: null, elevator: null,
  }));
  const call = (id: string, name: string, args: object) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });

  it("dispatches function calls through the tool registry and feeds results back", async () => {
    const turns = [
      [{ type: "message", content: [{ type: "output_text", text: "Searching first." }] }, call("c1", "search_shells", {})],
      [call("c2", "evaluate_candidates", { shellIds: ["S1", "S2"] })],
      [call("c3", "submit_reports", { shellIds: ["S2"] })],
    ];
    const inputs: unknown[][] = [];
    const openai = { model: "m", respond: async (b: Record<string, unknown>) => { inputs.push(structuredClone(b.input as unknown[])); return { output: turns.shift()! }; } };
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec, (e) => events.push(e), { shells: () => shells, graph: () => null }, { client: null, openai });
    expect(reports.map((r) => r.shellId)).toEqual(["S2"]);
    expect(inputs[1].at(-1)).toMatchObject({ type: "function_call_output", call_id: "c1" });
    expect(events.find((e) => e.type === "plan")).toMatchObject({ text: "Searching first." });
    expect(events.at(-1)).toMatchObject({ type: "done", planner: "openai" });
  });
});
