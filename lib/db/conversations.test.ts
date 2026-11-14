import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./index";
import { appendMessages, createConversation, listSaved, loadConversation, saveSpace, saveState, unsaveSpace } from "./conversations";
import type { RequirementSpec, ShellReport } from "../types";

beforeEach(() => {
  process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-conv-")), "h.db");
  closeDb();
});

const state = { spec: { mode: "business", useType: "salon", rooms: [], needs: {}, priorities: {}, input: "chat" }, asked: [], phase: "gathering" } as never;

describe("conversations", () => {
  it("appends with increasing seq across calls", async () => {
    const id = await createConversation("v1", state);
    await appendMessages(id, [{ role: "user", kind: "text", payload: { text: "hi" } }]);
    await appendMessages(id, [{ role: "bot", kind: "text", payload: { paragraphs: ["hello"] } }, { role: "user", kind: "text", payload: { text: "salon" } }]);
    expect((await loadConversation(id))!.messages.map((m) => [m.seq, m.role])).toEqual([[1, "user"], [2, "bot"], [3, "user"]]);
  });

  it("restores state, owner and last run", async () => {
    const id = await createConversation("v1", state);
    await saveState(id, { ...(state as object), phase: "results" } as never, "run-1");
    const c = await loadConversation(id)!;
    expect(c).toMatchObject({ viewerId: "v1", lastRunId: "run-1", state: { phase: "results" } });
  });

  it("returns null for unknown or unsafe ids", async () => {
    expect(await loadConversation("c_nope")).toBeNull();
    expect(await loadConversation("../x")).toBeNull();
  });

  it("saved spaces are per viewer", async () => {
    const report = { shellId: "S1", name: "Suite 1" } as ShellReport;
    const spec = { useType: "salon" } as RequirementSpec;
    await saveSpace("v1", report, spec);
    await saveSpace("v1", report, spec);
    expect((await listSaved("v1")).map((s) => s.report.shellId)).toEqual(["S1"]);
    expect(await listSaved("v2")).toEqual([]);
    await unsaveSpace("v1", "S1");
    expect(await listSaved("v1")).toEqual([]);
  });
});
