import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../db";
import { checkRules } from "../reason/rules";
import { lookupZoning, normalizeZone, parseZoningResponse, zoningAgreement } from "./zoning";
import type { RequirementSpec, Shell } from "../types";

const FIXTURE = { features: [{ attributes: { APN24: "5442022004", CITY: "Los Angeles", ZN24_CITY: "CM" } }] };

beforeEach(() => {
  process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-z-")), "h.db");
  closeDb();
});

describe("zoning lookup", () => {
  it("parses the zone code from an ArcGIS point query", () => {
    expect(parseZoningResponse(FIXTURE)).toEqual({ zone: "CM", apn: "5442022004" });
    expect(parseZoningResponse({ features: [] })).toBeNull();
  });

  it("returns null outside Los Angeles without calling the service", async () => {
    let calls = 0;
    expect(await lookupZoning(29.76, -95.37, async () => { calls++; return new Response("{}"); })).toBeNull();
    expect(calls).toBe(0);
  });

  it("caches a lookup so the second call makes no request", async () => {
    let calls = 0;
    const f = async (url: string | URL | Request) => { calls++; expect(String(url)).toContain("geometry=-118.24432%2C34.10422"); return new Response(JSON.stringify(FIXTURE)); };
    const a = await lookupZoning(34.104217, -118.244322, f as typeof fetch);
    const b = await lookupZoning(34.104217, -118.244322, f as typeof fetch);
    expect(a).toMatchObject({ zone: "CM", source: expect.stringContaining("scag") });
    expect(b?.zone).toBe("CM");
    expect(calls).toBe(1);
  });

  it("does not cache an ArcGIS error reply as 'no zone'", async () => {
    let calls = 0;
    const f = async () => { calls++; return new Response(JSON.stringify({ error: { code: 500, message: "busy" } })); };
    expect(await lookupZoning(34.05, -118.25, f as typeof fetch)).toBeNull();
    await lookupZoning(34.05, -118.25, f as typeof fetch);
    expect(calls).toBe(2);
  });

  it("returns null when the service fails", async () => {
    expect(await lookupZoning(34.05, -118.25, async () => new Response("oops", { status: 500 }))).toBeNull();
  });
});

describe("zone comparison", () => {
  it("normalizes CoStar and SCAG codes to the base zone", () => {
    expect(normalizeZone("LAM2-1")).toBe("M2");
    expect(normalizeZone("C4, Los Angeles")).toBe("C4");
    expect(normalizeZone("[Q]C2-1VL")).toBe("C2");
    expect(normalizeZone("CR-1L-O")).toBe("CR");
    expect(normalizeZone("C2")).toBe("C2");
  });

  it("agrees, disagrees or cannot tell", () => {
    expect(zoningAgreement("C2-3", "C2")).toBe("agree");
    expect(zoningAgreement("MR1, Los Angeles", "M1")).toBe("disagree");
    expect(zoningAgreement(null, "C2")).toBe("unknown");
  });
});

describe("checkRules with a parcel zoning cross-check", () => {
  const shell = { id: "S", city: "los_angeles", zoning: "LAC4", useTags: [], sprinkler: "unknown", heavyPower: null, driveInBays: null, loadingDocks: null, parkingSpaces: null, elevator: null } as unknown as Shell;
  const spec = { mode: "business", city: "los_angeles", useType: "salon", rooms: [], needs: {}, priorities: {}, input: "chat" } as RequirementSpec;

  it("warns when the parcel layer disagrees with the CoStar zone", () => {
    const hit = checkRules(spec, shell, undefined, { parcelZone: { zone: "MU", source: "scag", apn: "1" } }).find((h) => h.rule === "zoning_records");
    expect(hit).toMatchObject({ status: "warn" });
    expect(hit?.detail).toMatch(/disagree/i);
  });

  it("confirms when they agree", () => {
    const hit = checkRules(spec, shell, undefined, { parcelZone: { zone: "C4", source: "scag", apn: "1" } }).find((h) => h.rule === "zoning_records");
    expect(hit?.status).toBe("pass");
  });
});
