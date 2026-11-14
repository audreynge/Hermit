import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../db";
import { isOfficial } from "./domains";
import { researchRegulations, type Finding } from "./research";

beforeEach(() => {
  process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-r-")), "h.db");
  closeDb();
});

const searchBlock = (urls: string[]) => ({ type: "web_search_tool_result", tool_use_id: "s1", content: urls.map((url) => ({ type: "web_search_result", url, title: "t" })) });
const finding = (url: string, over: Partial<Finding> = {}) => ({
  topic: "professional_license", jurisdiction: "state", requirement: "Salons need an establishment license", appliesWhen: "operating a salon",
  certainty: "applies", url, citedText: "An establishment license is required…", ...over,
});

function fakeClient(searchUrls: string[], findings: unknown[]) {
  const calls = { create: 0, parse: 0, createReq: null as unknown };
  const client = {
    messages: {
      create: async (req: unknown) => { calls.create++; calls.createReq = req; return { stop_reason: "end_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } }, searchBlock(searchUrls), { type: "text", text: "Summary of rules." }] }; },
      parse: async () => { calls.parse++; return { parsed_output: { findings } }; },
    },
  };
  return { client: client as never, calls };
}

const q = { city: "los_angeles" as const, useType: "hair salon" };

describe("researchRegulations", () => {
  it("keeps findings whose url came from the search results and stamps the retrieval date", async () => {
    const url = "https://www.barbercosmo.ca.gov/forms_pubs/establishment.shtml";
    const { client, calls } = fakeClient([url], [finding(url)]);
    const r = await researchRegulations(q, client);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ url, jurisdiction: "state", retrievedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/) });
    const tools = (calls.createReq as { tools: { type: string; allowed_domains: string[] }[] }).tools;
    expect(tools[0].type).toBe("web_search_20260209");
    expect(tools[0].allowed_domains).toContain("barbercosmo.ca.gov");
  });

  it("drops a finding with a url the search never returned", async () => {
    const { client } = fakeClient(["https://www.barbercosmo.ca.gov/a"], [finding("https://www.barbercosmo.ca.gov/made-up")]);
    expect((await researchRegulations(q, client)).findings).toEqual([]);
  });

  it("drops a non-official domain even if the search returned it", async () => {
    const url = "https://someblog.example.com/salon-rules";
    const { client } = fakeClient([url], [finding(url)]);
    expect((await researchRegulations(q, client)).findings).toEqual([]);
  });

  it("serves the second identical query from cache without calling the client", async () => {
    const url = "https://dbs.lacity.gov/permits";
    const { client, calls } = fakeClient([url], [finding(url, { jurisdiction: "city", topic: "occupancy" })]);
    await researchRegulations(q, client);
    const again = await researchRegulations(q, client);
    expect(again.fromCache).toBe(true);
    expect(again.findings).toHaveLength(1);
    expect(calls.create).toBe(1);
  });

  it("falls back to cited screening rules with no client, without caching them", async () => {
    const r = await researchRegulations({ city: "houston", useType: "salon" }, null);
    expect(r.fromCache).toBe(false);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.certainty === "may_apply" && f.url.startsWith("https://"))).toBe(true);
    expect(r.findings.some((f) => f.topic === "zoning" && /deed restriction/i.test(f.requirement))).toBe(true);
    const { client, calls } = fakeClient([], []);
    await researchRegulations({ city: "houston", useType: "salon" }, client);
    expect(calls.create).toBe(1);
  });
});

describe("isOfficial", () => {
  it("accepts official hosts and their subdomains only", () => {
    expect(isOfficial("https://dbs.lacity.gov/x")).toBe(true);
    expect(isOfficial("https://www.tdlr.texas.gov/cosmet/cosmet.htm")).toBe(true);
    expect(isOfficial("https://lacity.gov.evil.com/x")).toBe(false);
    expect(isOfficial("not a url")).toBe(false);
  });
});
