// Shared fixtures for design-edit tests and the language eval. Sample data only (no private records).
import fs from "node:fs";
import path from "node:path";
import type { Block } from "../spec/parse";
import type { RequirementSpec, RoomGraph, Shell } from "../types";

const SAMPLE = path.join(process.cwd(), "data", "sample");
export const sampleGraph = (sid: string): RoomGraph => JSON.parse(fs.readFileSync(path.join(SAMPLE, "roomgraphs", `${sid}.json`), "utf8"));
export const sampleShell = (id: string): Shell => (JSON.parse(fs.readFileSync(path.join(SAMPLE, "shells.json"), "utf8")) as Shell[]).find((s) => s.id === id)!;
export const SAMPLE_SIDS = ["SAMPLEHOME1", "SAMPLEHOME2", "SAMPLEMED1", "SAMPLEMED2", "SAMPLEMED3", "SAMPLEWH1"];

/** Layout Studio's default clinic template. */
export const CLINIC: Block[] = [
  { id: "t1", kind: "room", label: "reception", x: 4, y: 4, w: 52, h: 13 },
  { id: "t2", kind: "room", label: "exam room", x: 4, y: 17, w: 23, h: 10 },
  { id: "t3", kind: "room", label: "exam room", x: 4, y: 27, w: 23, h: 10 },
  { id: "t4", kind: "room", label: "hallway", x: 27, y: 17, w: 12, h: 20 },
  { id: "t5", kind: "room", label: "storage", x: 39, y: 17, w: 17, h: 20 },
  { id: "o2", kind: "object", label: "chair", x: 11, y: 10, w: 3, h: 3.5 },
  { id: "o5", kind: "object", label: "reception desk", x: 39, y: 8, w: 12, h: 5 },
  { id: "o10", kind: "object", label: "sink", x: 22, y: 18.5, w: 3.5, h: 3 },
  { id: "o13", kind: "object", label: "sink", x: 22, y: 32.5, w: 3.5, h: 3 },
];

/** A small office: open area, two offices, a conference room, a kitchen. */
export const OFFICE: Block[] = [
  { id: "a1", kind: "room", label: "open area", x: 0, y: 0, w: 30, h: 20 },
  { id: "a2", kind: "room", label: "office", x: 30, y: 0, w: 10, h: 10 },
  { id: "a3", kind: "room", label: "office", x: 30, y: 10, w: 10, h: 10 },
  { id: "a4", kind: "room", label: "conference", x: 0, y: 20, w: 14, h: 12 },
  { id: "a5", kind: "room", label: "kitchen", x: 14, y: 20, w: 10, h: 8 },
];

/** A salon: one styling floor, a bathroom and storage. */
export const SALON: Block[] = [
  { id: "s1", kind: "room", label: "open area", x: 0, y: 0, w: 24, h: 20 },
  { id: "s2", kind: "room", label: "bathroom", x: 24, y: 0, w: 7, h: 8 },
  { id: "s3", kind: "room", label: "storage", x: 24, y: 8, w: 8, h: 8 },
  { id: "s4", kind: "object", label: "sink", x: 2, y: 2, w: 3, h: 3 },
];

export const clinicSpec = (over: Partial<RequirementSpec> = {}): RequirementSpec => ({
  mode: "business", city: "houston", useType: "medical clinic",
  rooms: [{ label: "exam room", count: 2, hard: false }, { label: "reception", count: 1, hard: false }],
  needs: {}, priorities: {}, input: "chat", ...over,
});
export const homeOfficeSpec = (over: Partial<RequirementSpec> = {}): RequirementSpec => ({
  mode: "home", city: "houston", useType: "home",
  rooms: [{ label: "bedroom", count: 2, hard: false }, { label: "office", count: 1, hard: false }],
  needs: {}, priorities: {}, input: "chat", ...over,
});
