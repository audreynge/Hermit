import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db";
import { importBundle } from "../../pipeline/import-db";
import { dataDir, getShell, isSafeId, loadRoomGraph, loadShells, searchCandidates } from "./load";

describe("isSafeId", () => {
  it("accepts Matterport sids and shell ids, rejects path tricks", () => {
    expect(isSafeId("NgGvLZnbEMM")).toBe(true);
    expect(isSafeId("prop-83684")).toBe(true);
    expect(isSafeId("../../etc/passwd")).toBe(false);
    expect(isSafeId("a/b")).toBe(false);
    expect(isSafeId("")).toBe(false);
  });
});

describe("loaders backed by sqlite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-"));
  beforeAll(() => {
    fs.mkdirSync(path.join(dir, "roomgraphs"));
    fs.writeFileSync(path.join(dir, "shells.json"), JSON.stringify([
      { id: "A1", sid: "SID1", mode: "business", city: "houston", sqft: 900 },
      { id: "B2", mode: "home", city: "houston" },
      { id: "C3", mode: "enterprise", city: "los_angeles" },
    ]));
    fs.writeFileSync(path.join(dir, "roomgraphs", "SID1.json"), JSON.stringify({ sid: "SID1", rooms: [] }));
    process.env.HERMIT_DATA_DIR = dir;
    delete process.env.HERMIT_DB;
    closeDb();
  });

  it("imports the JSON bundle into the database on first use", () => {
    expect(dataDir()).toBe(dir);
    expect(loadShells().map((s) => s.id).sort()).toEqual(["A1", "B2", "C3"]);
    expect(fs.existsSync(path.join(dir, "hermit.db"))).toBe(true);
    expect(getShell("A1")?.sqft).toBe(900);
  });

  it("lazily loads a room graph and returns null when missing or unsafe", () => {
    expect(loadRoomGraph("SID1")?.sid).toBe("SID1");
    expect(loadRoomGraph("NOPE")).toBeNull();
    expect(loadRoomGraph("../shells")).toBeNull();
  });

  it("searchCandidates only returns the requested city and modes", () => {
    expect(searchCandidates("houston", ["business", "enterprise"]).map((s) => s.id)).toEqual(["A1"]);
    expect(searchCandidates("los_angeles", ["enterprise"]).map((s) => s.id)).toEqual(["C3"]);
  });

  it("re-importing is idempotent", () => {
    importBundle(dir);
    importBundle(dir);
    expect(db().prepare("SELECT count(*) AS n FROM shells").get()).toEqual({ n: 3 });
  });
});
