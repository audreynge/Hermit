import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRoom, panosByRoom } from "./look";
import { loadPanoCheck, loadPanoChecks } from "./pano";

const sq = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

let dir: string;
const env = { ...process.env };

function writeGraph(sid: string) {
  fs.mkdirSync(path.join(dir, "roomgraphs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "roomgraphs", `${sid}.json`), JSON.stringify({
    sid, name: sid, totalAreaSqft: 0, edges: [], objects: [], panoCount: 2, floorCount: 1,
    rooms: [
      { id: "exam1", label: "office", rawTags: ["office"], areaSqft: 100, polygon: sq(0, 0, 3, 3), floorId: "f1" },
      { id: "closet", label: "storage", rawTags: ["storage"], areaSqft: 20, polygon: sq(5, 5, 6, 6), floorId: "f1" },
    ],
  }));
}

function mockFetch(geminiAnswer: object) {
  const calls: string[] = [];
  const face = sharp({ create: { width: 64, height: 64, channels: 3, background: "#ccc" } }).jpeg().toBuffer();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).includes("api.matterport.com")) {
      return new Response(JSON.stringify({ data: { model: { panoLocations: [
        { id: "pA", position: { x: 1.5, y: 1.5, z: 1.3 }, skyboxes: [{ resolution: "2k", status: "available", children: [0, 1, 2, 3, 4, 5].map((i) => `https://cdn.test/pA/${i}.jpg`) }] },
        { id: "pB", position: { x: 20, y: 20, z: 1.3 }, skyboxes: [] },
      ] } } }));
    }
    if (String(url).startsWith("https://cdn.test/")) return new Response(new Uint8Array(await face));
    if (String(url).includes("generativelanguage")) {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.temperature).toBe(0);
      expect(body.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData)).toHaveLength(4);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiAnswer) }] } }] }));
    }
    return new Response("nope", { status: 404 });
  }));
  return calls;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-vision-"));
  process.env.HERMIT_DATA_DIR = dir;
  process.env.MATTERPORTAPIKEY = "k";
  process.env.MATTERPORTAPITOKEN = "t";
  process.env.GEMINI_API_KEY = "g";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...env };
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("panosByRoom", () => {
  it("maps panos to rooms by point-in-polygon", async () => {
    writeGraph("sidMap");
    mockFetch({});
    expect(await panosByRoom("sidMap")).toEqual({ exam1: [{ id: "pA", x: 1.5, y: 1.5 }] });
  });
});

describe("checkRoom", () => {
  it("saves a crop for seen, downgrades seen-without-box, and upserts checks.json", async () => {
    writeGraph("sidSeen");
    const calls = mockFetch({ walls_visible: "most", features: [
      { feature: "sink", result: "seen", image: 2, box_2d: [300, 300, 600, 600], note: "A sink with a cabinet along the left wall." },
      { feature: "toilet", result: "seen", image: 0, box_2d: [], note: "Maybe a toilet." },
      { feature: "counter", result: "not_seen", image: 1, box_2d: [], note: "No counter." },
    ] });
    const out = await checkRoom("sidSeen", "exam1", ["sink", "toilet", "counter"]);
    // Wall faces only: 1-4, never ceiling (0) or floor (5).
    expect(calls.filter((u) => u.startsWith("https://cdn.test/")).sort()).toEqual([1, 2, 3, 4].map((i) => `https://cdn.test/pA/${i}.jpg`));
    expect(out.map((c) => c.result)).toEqual(["seen", "unclear", "unclear"]);
    expect(out[0]).toMatchObject({ panoId: "pA", face: 3, image: "panos/sidSeen/exam1-sink.jpg", confidence: 0.8 });
    expect(fs.existsSync(path.join(dir, "panos", "sidSeen", "exam1-sink.jpg"))).toBe(true);
    expect(loadPanoChecks("sidSeen")).toHaveLength(3);
    expect(loadPanoCheck("sidSeen", "exam1", "SINK")?.result).toBe("seen");
    expect(loadPanoCheck("sidSeen", "exam1", "exam table")).toBeNull();
  });

  it("returns unclear with no photo when no pano is inside the room", async () => {
    writeGraph("sidNone");
    const calls = mockFetch({});
    const out = await checkRoom("sidNone", "closet", ["sink"]);
    expect(out[0]).toMatchObject({ result: "unclear", note: "No scan photo was taken inside this room." });
    expect(out[0].image).toBeUndefined();
    expect(calls.some((u) => u.includes("generativelanguage"))).toBe(false);
  });
});

describe("loaders", () => {
  it("return empty / null for missing, bad ids or broken files", () => {
    expect(loadPanoChecks("nothing")).toEqual([]);
    expect(loadPanoChecks("../etc")).toEqual([]);
    fs.mkdirSync(path.join(dir, "panos", "broken"), { recursive: true });
    fs.writeFileSync(path.join(dir, "panos", "broken", "checks.json"), "{");
    expect(loadPanoChecks("broken")).toEqual([]);
    expect(loadPanoCheck("broken", "r", "sink")).toBeNull();
  });
});
