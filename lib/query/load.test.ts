import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { dataDir, isSafeId, loadRoomGraph, loadShells } from "./load";

describe("isSafeId", () => {
  it("accepts Matterport sids and shell ids, rejects path tricks", () => {
    expect(isSafeId("NgGvLZnbEMM")).toBe(true);
    expect(isSafeId("prop-83684")).toBe(true);
    expect(isSafeId("../../etc/passwd")).toBe(false);
    expect(isSafeId("a/b")).toBe(false);
    expect(isSafeId("")).toBe(false);
  });
});

describe("loaders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-"));
  beforeAll(() => {
    fs.mkdirSync(path.join(dir, "roomgraphs"));
    fs.writeFileSync(path.join(dir, "shells.json"), JSON.stringify([{ id: "A1", sid: "SID1" }]));
    fs.writeFileSync(path.join(dir, "roomgraphs", "SID1.json"), JSON.stringify({ sid: "SID1", rooms: [] }));
    process.env.HERMIT_DATA_DIR = dir;
  });

  it("reads the bundle named by HERMIT_DATA_DIR", () => {
    expect(dataDir()).toBe(dir);
    expect(loadShells()[0].id).toBe("A1");
  });

  it("lazily loads a room graph and returns null when missing or unsafe", () => {
    expect(loadRoomGraph("SID1")?.sid).toBe("SID1");
    expect(loadRoomGraph("NOPE")).toBeNull();
    expect(loadRoomGraph("../shells")).toBeNull();
  });
});
