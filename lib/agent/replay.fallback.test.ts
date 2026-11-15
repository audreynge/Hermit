import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-replay-fallback-"));
const db = vi.hoisted(() => ({ q: vi.fn(), usingPostgres: vi.fn(() => true), all: vi.fn((): unknown[] => []) }));
vi.mock("../db", () => ({ q: db.q, usingPostgres: db.usingPostgres, db: () => ({ prepare: () => ({ all: db.all }) }) }));
vi.mock("../query/load", () => ({ dataDir: () => dir, ensureImported: () => {}, isSafeId: (id: string) => /^[A-Za-z0-9_-]{1,40}$/.test(id) }));
import { listRuns, loadRun } from "./replay";

const spec = { mode: "business", city: "houston", useType: "medical clinic", rooms: [], needs: {}, priorities: {}, input: "text" };
fs.mkdirSync(path.join(dir, "replay"), { recursive: true });
fs.writeFileSync(path.join(dir, "replay", "clinic.json"), JSON.stringify({ id: "clinic", createdAt: "2026-11-14T22:46:07.458Z", spec, events: [{ type: "plan", id: "e1", text: "hi" }] }));

describe("replay falls back to the bundled JSON", () => {
  beforeEach(() => { db.q.mockReset(); db.all.mockReset(); db.all.mockReturnValue([]); });

  it("reads data/processed/replay/<id>.json when Postgres lacks the run", async () => {
    db.q.mockResolvedValue([]);
    const r = await loadRun("clinic");
    expect(r).toMatchObject({ id: "clinic", spec: { useType: "medical clinic" } });
    expect(r!.events).toHaveLength(1);
  });

  it("reads the JSON when Postgres throws (offline)", async () => {
    db.q.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await loadRun("clinic"))?.id).toBe("clinic");
    expect((await listRuns()).map((r) => r.id)).toContain("clinic");
  });

  it("prefers the database row, and lists each run once", async () => {
    db.q.mockResolvedValue([{ id: "clinic", created_at: "2026-11-15T00:00:00.000Z", spec_json: JSON.stringify({ ...spec, useType: "dental clinic" }), events_json: "[]" }]);
    expect((await loadRun("clinic"))?.spec.useType).toBe("dental clinic");
    expect((await listRuns()).filter((r) => r.id === "clinic")).toHaveLength(1);
  });

  it("still returns null for missing or unsafe ids", async () => {
    db.q.mockResolvedValue([]);
    expect(await loadRun("nope")).toBeNull();
    expect(await loadRun("../../etc/passwd")).toBeNull();
  });
});
