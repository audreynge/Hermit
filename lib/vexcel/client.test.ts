import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { isVexcelView, vexcelImage } from "./client";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
function fakeFetch(status = 200) {
  const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("X-API-KEY") });
    return new Response(status === 200 ? jpeg : "{}", { status, headers: { "Content-Type": status === 200 ? "image/jpeg" : "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("vexcelImage", () => {
  beforeEach(() => {
    process.env.HERMIT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vx-"));
    process.env.VEXCELAPIKEY = " k1 ";
  });

  it("validates view names", () => {
    expect(isVexcelView("ortho")).toBe(true);
    expect(isVexcelView("oblique-west")).toBe(true);
    expect(isVexcelView("../etc")).toBe(false);
  });

  it("requests ortho with lon-first WKT and all layers, then serves from disk cache", async () => {
    const f = fakeFetch();
    expect(await vexcelImage(29.7366, -95.4613, "ortho", f.fn)).toEqual(jpeg);
    expect(f.calls[0].url).toBe("https://api.vexcelgroup.com/v2/ortho/extract");
    expect(f.calls[0].key).toBe("k1");
    expect(f.calls[0].body).toMatchObject({ wkt: "POINT(-95.4613 29.7366)", srid: 4326, layer: "urban,urban-r,wide-area,urban-g" });
    await vexcelImage(29.7366, -95.4613, "ortho", f.fn);
    expect(f.calls).toHaveLength(1);
  });

  it("obliques use the oriented endpoint on the urban layer", async () => {
    const f = fakeFetch();
    await vexcelImage(34.03, -118.39, "oblique-north", f.fn);
    expect(f.calls[0].url).toBe("https://api.vexcelgroup.com/v2/oriented/extract");
    expect(f.calls[0].body).toMatchObject({ layer: "urban", "product-type": "oblique-north", rotation: "natural" });
  });

  it("returns null without a key or when Vexcel has no image, and does not cache the miss", async () => {
    const f = fakeFetch(404);
    expect(await vexcelImage(1, 2, "ortho", f.fn)).toBeNull();
    expect(await vexcelImage(1, 2, "ortho", f.fn)).toBeNull();
    expect(f.calls).toHaveLength(2);
    delete process.env.VEXCELAPIKEY;
    expect(await vexcelImage(1, 2, "oblique-east", fakeFetch().fn)).toBeNull();
  });
});
