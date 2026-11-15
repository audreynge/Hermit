import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../db";
import { modelBounds, rankModels, searchModels, sketchfabDownloadUrl } from "./search";
import type { Model } from "./ops";

// Shape recorded from a live api.poly.pizza/v1/search/stove response (2026-11-14), trimmed.
const r = (ID: string, Title: string, extra = {}) => ({
  ID, Title, Thumbnail: `https://static.poly.pizza/${ID}.webp`, Download: `https://static.poly.pizza/${ID}.glb`, Licence: "CC0 1.0",
  Attribution: `"${Title}" by Someone, https://poly.pizza/m/${ID}. Licence at https://creativecommons.org/publicdomain/zero/1.0/`, "Tri Count": 858, Animated: false, ...extra,
});
const RESULTS: Record<string, object[]> = {
  stove: [r("a1", "Stove"), r("a2", "Kitchen Stove"), r("a3", "Stove Animated", { Animated: true }), r("a4", "Stove Huge", { "Tri Count": 900_000 })],
  "host stand": [r("h1", "Hostel"), r("h2", "Hotel")],
  podium: [r("p1", "Podium")],
};

function mock(status = 200) {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    const q = decodeURIComponent(url.split("/search/")[1].split("?")[0]);
    return new Response(JSON.stringify({ results: RESULTS[q] ?? [] }), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

beforeEach(() => {
  process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-f-")), "h.db");
  process.env.POLYPIZZA_API_KEY = "test-key";
  delete process.env.SKETCHFAB_API_KEY;
  closeDb();
});

// Shape recorded from a live api.sketchfab.com/v3/search response (2026-11-14), trimmed.
const sf = (uid: string, name: string, extra = {}) => ({
  uid, name, viewerUrl: `https://sketchfab.com/3d-models/x-${uid}`, faceCount: 2000, animationCount: 0, license: { label: "CC Attribution" },
  user: { displayName: "Maker", username: "maker" }, thumbnails: { images: [{ width: 1024, url: "big" }, { width: 256, url: `https://media.sketchfab.com/${uid}-256.jpeg` }] },
  archives: { glb: { size: 1_500_000 } }, ...extra,
});
const U = (n: number) => String(n).padStart(32, "a");
const SF: Record<string, object[]> = {
  stove: [sf(U(1), "Gas Stove"), sf(U(2), "Stove NC", { license: { label: "CC Attribution-NonCommercial" } }), sf(U(3), "Stove ND", { license: { label: "CC Attribution-NoDerivs" } }),
    sf(U(4), "Huge Stove", { archives: { glb: { size: 40_000_000 } } }), sf(U(5), "Animated Stove", { animationCount: 2 }), sf(U(6), "Lamp")],
};
function mockBoth() {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    if (url.includes("sketchfab.com/v3/search")) return new Response(JSON.stringify({ results: SF[new URL(url).searchParams.get("q")!] ?? [] }));
    if (url.includes("sketchfab.com/v3/models/")) return new Response(JSON.stringify({ glb: { url: "https://signed.example/m.glb?sig=1", expires: 300 } }));
    const q = decodeURIComponent(url.split("/search/")[1].split("?")[0]);
    return new Response(JSON.stringify({ results: RESULTS[q] ?? [] }));
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

describe("sketchfab", () => {
  beforeEach(() => { process.env.SKETCHFAB_API_KEY = "sf-key"; });

  it("keeps small, static, freely licensed, matching models and lists them before Poly Pizza", async () => {
    const { fetchFn } = mockBoth();
    const models = await searchModels(["stove"], 10, fetchFn);
    expect(models.map((m) => m.id)).toEqual([`sf-${U(1)}`, "a1", "a2"]);
    expect(models[0]).toMatchObject({ source: "sketchfab", url: `/api/furniture/model/sketchfab/${U(1)}`, thumb: `https://media.sketchfab.com/${U(1)}-256.jpeg`, licence: "CC Attribution" });
    expect(models[0].attribution).toContain("by Maker");
  });

  it("caches each source per query", async () => {
    const { fetchFn, urls } = mockBoth();
    await searchModels(["stove"], 5, fetchFn);
    await searchModels(["stove"], 5, fetchFn);
    expect(urls).toHaveLength(2); // one Sketchfab search, one Poly Pizza search
  });

  it("signs a download once and reuses it for four minutes; bad uids and no key give null", async () => {
    const { fetchFn, urls } = mockBoth();
    const t = 1_000_000;
    expect(await sketchfabDownloadUrl(U(1), fetchFn, t)).toBe("https://signed.example/m.glb?sig=1");
    await Promise.all([sketchfabDownloadUrl(U(1), fetchFn, t + 1000), sketchfabDownloadUrl(U(1), fetchFn, t + 2000)]);
    expect(urls.filter((u) => u.includes("/download"))).toHaveLength(1);
    await sketchfabDownloadUrl(U(1), fetchFn, t + 300_000);
    expect(urls.filter((u) => u.includes("/download"))).toHaveLength(2);
    expect(await sketchfabDownloadUrl("../etc", fetchFn)).toBeNull();
    delete process.env.SKETCHFAB_API_KEY;
    expect(await sketchfabDownloadUrl(U(2), fetchFn)).toBeNull();
  });
});

describe("searchModels", () => {
  it("returns matching static GLB models with licence and attribution", async () => {
    const { fetchFn } = mock();
    const models = await searchModels(["stove"], 5, fetchFn);
    expect(models.map((m) => m.id)).toEqual(["a1", "a2"]); // animated and heavy models dropped
    expect(models[0]).toMatchObject({ url: "https://static.poly.pizza/a1.glb", licence: "CC0 1.0" });
    expect(models[0].attribution).toContain("poly.pizza/m/a1");
  });

  it("caches: the same query twice makes one request", async () => {
    const { fetchFn, urls } = mock();
    await searchModels(["stove"], 5, fetchFn);
    await searchModels(["Stoves"], 5, fetchFn); // normalized to the same query
    expect(urls).toHaveLength(1);
  });

  it("shares one request between concurrent identical queries", async () => {
    const { fetchFn, urls } = mock();
    await Promise.all([searchModels(["stove"], 5, fetchFn), searchModels(["stove"], 5, fetchFn), searchModels(["stove"], 5, fetchFn)]);
    expect(urls).toHaveLength(1);
  });

  it("filters mismatched titles and falls through to the next term; misses are cached too", async () => {
    const { fetchFn, urls } = mock();
    expect((await searchModels(["host stand", "podium"], 5, fetchFn)).map((m) => m.id)).toEqual(["p1"]);
    expect(await searchModels(["host stand"], 5, fetchFn)).toEqual([]);
    expect(urls).toHaveLength(2); // "host stand" once, "podium" once
  });

  it("skips vague category terms", async () => {
    const { fetchFn, urls } = mock();
    await searchModels(["living room furniture", "furniture", "stove"], 5, fetchFn);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/search/stove");
  });

  it("tries at most three terms", async () => {
    const { fetchFn, urls } = mock();
    await searchModels(["x1", "x2", "x3", "x4", "x5"], 5, fetchFn);
    expect(urls).toHaveLength(3);
  });

  it("returns [] without a key, and on upstream errors without caching them", async () => {
    delete process.env.POLYPIZZA_API_KEY;
    const none = mock();
    expect(await searchModels(["stove"], 5, none.fetchFn)).toEqual([]);
    expect(none.urls).toHaveLength(0);
    process.env.POLYPIZZA_API_KEY = "test-key";
    const down = mock(429);
    expect(await searchModels(["stove"], 5, down.fetchFn)).toEqual([]);
    const up = mock();
    expect(await searchModels(["stove"], 5, up.fetchFn)).toHaveLength(2);
    expect(up.urls).toHaveLength(1);
  });
});

// A minimal GLB header whose single mesh spans min..max.
function glb(min: number[], max: number[]): Uint8Array {
  let text = JSON.stringify({ scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ min, max }] });
  while (text.length % 4) text += " ";
  const body = new TextEncoder().encode(text), out = new Uint8Array(20 + body.length + 1000); // + fake binary chunk
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true); v.setUint32(12, body.length, true); v.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

describe("model dimensions and ranking", () => {
  const model = (id: string): Model => ({ id, source: "polypizza", url: `https://static.example/${id}.glb`, title: id, thumb: "", licence: "CC0 1.0", attribution: id });
  const FILES: Record<string, Uint8Array> = {
    slim: glb([-20, 0, -20], [20, 65, 20]), // 40 × 65 × 40 cm: a typical trash can
    squat: glb([-180, 0, -180], [180, 300, 180]),
    scene: glb([-500, 0, -500], [500, 5, 500]), // a flat scene
  };
  function serve() {
    const ranges: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      ranges.push(String((init?.headers as Record<string, string>)?.Range));
      const f = FILES[url.split("/").pop()!.replace(".glb", "")];
      if (!f) return new Response("nope", { status: 404 });
      const end = Number(String((init?.headers as Record<string, string>).Range).split("-")[1]);
      return new Response(f.slice(0, end + 1), { status: 206 });
    }) as unknown as typeof fetch;
    return { fetchFn, ranges };
  }

  it("reads bounds from a range request and caches them per model", async () => {
    const { fetchFn, ranges } = serve();
    expect(await modelBounds(model("slim"), fetchFn)).toEqual({ min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 65, z: 20 } });
    await modelBounds(model("slim"), fetchFn);
    expect(ranges).toEqual(["bytes=0-262143"]);
  });

  it("ranks the best-proportioned model first and clear misfits last", async () => {
    const { fetchFn } = serve();
    const ranked = await rankModels([model("scene"), model("squat"), model("slim"), model("missing")], { w: 0.4, d: 0.4, h: 0.65 }, fetchFn);
    expect(ranked.map((m) => m.id)).toEqual(["slim", "squat", "missing", "scene"]);
    expect(ranked[0].bounds).toBeDefined();
  });

  it("keeps search order when the item's size is unknown", async () => {
    const { fetchFn } = serve();
    expect((await rankModels([model("scene"), model("slim")], null, fetchFn)).map((m) => m.id)).toEqual(["scene", "slim"]);
  });
});

describe("sketchfab rate limits", () => {
  beforeEach(() => { process.env.SKETCHFAB_API_KEY = "sf-key"; });

  it("backs off for a minute after a 429 instead of hammering the download API", async () => {
    let calls = 0;
    const limited = (async () => { calls++; return new Response("slow down", { status: 429 }); }) as unknown as typeof fetch;
    const t = 50_000_000;
    expect(await sketchfabDownloadUrl("b".repeat(32), limited, t)).toBeNull();
    expect(await sketchfabDownloadUrl("c".repeat(32), limited, t + 30_000)).toBeNull();
    expect(calls).toBe(1);
    const ok = (async () => new Response(JSON.stringify({ glb: { url: "https://signed.example/x.glb" } }))) as unknown as typeof fetch;
    expect(await sketchfabDownloadUrl("d".repeat(32), ok, t + 61_000)).toBe("https://signed.example/x.glb");
  });

  it("measures at most two Sketchfab candidates per search (each costs a download call)", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ glb: { url: "https://signed.example/m.glb" } })); }) as unknown as typeof fetch;
    const sfModel = (i: number): Model => ({ id: `sf-${String(i).padStart(32, "e")}`, source: "sketchfab", url: "/x", title: "t", thumb: "", licence: "CC Attribution", attribution: "a" });
    await rankModels([1, 2, 3, 4].map(sfModel), { w: 1, d: 1, h: 1 }, fetchFn);
    expect(urls.filter((u) => u.includes("/download"))).toHaveLength(2);
  });
});
