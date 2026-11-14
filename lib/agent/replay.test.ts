import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listRuns, loadRun, newRunId, saveRun } from "./replay";
import { decodeSpec, encodeSpec } from "../spec/url";
import type { RequirementSpec, TraceEvent } from "../types";

const spec: RequirementSpec = { mode: "business", city: "houston", useType: "dental clinic", rooms: [{ label: "exam room", count: 3, hard: false }], needs: { wheelchair: true }, priorities: {}, input: "text" };

describe("replay store", () => {
  process.env.HERMIT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-replay-"));

  it("round-trips a recorded run", () => {
    const id = newRunId();
    const events: TraceEvent[] = [{ type: "plan", id: "e1", text: "hi" }];
    saveRun(id, spec, events);
    expect(loadRun(id)).toMatchObject({ id, spec, events });
    expect(listRuns().map((r) => r.id)).toContain(id);
  });

  it("refuses unsafe ids and returns null for missing runs", () => {
    expect(loadRun("../../etc/passwd")).toBeNull();
    expect(loadRun("nope")).toBeNull();
    expect(() => saveRun("../x", spec, [])).toThrow();
  });
});

describe("spec url encoding", () => {
  it("round-trips a spec through a URL-safe string", () => {
    const s = encodeSpec(spec);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSpec(s)).toEqual(spec);
  });

  it("returns null for garbage or schema-invalid input", () => {
    expect(decodeSpec("!!!")).toBeNull();
    expect(decodeSpec(encodeSpec({ ...spec, city: "paris" } as never))).toBeNull();
  });
});
