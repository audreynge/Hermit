import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runAgent } from "../lib/agent/loop";
import { loadRoomGraph, loadShells } from "../lib/query/load";
import { parseText } from "../lib/spec/parse";

const SAMPLE = path.join(process.cwd(), "data", "sample");

it("ships a synthetic bundle that answers all three modes without credentials", async () => {
  process.env.HERMIT_DATA_DIR = SAMPLE;
  const shells = loadShells();
  expect(shells.every((s) => s.name.includes("Sample") || s.address.includes("Sample"))).toBe(true);
  for (const q of [
    "Dental clinic in Houston, 2,000-3,000 sq ft, 3 exam rooms with sinks, 2 restrooms",
    "20,000 sf warehouse in Los Angeles with heavy power and 2 drive-in doors",
    "3 bedroom 2 bath house in Houston under $450k",
  ]) {
    const reports = await runAgent(parseText(q), () => {}, { shells: loadShells, graph: loadRoomGraph }, { client: null });
    expect(reports.length, q).toBeGreaterThan(0);
  }
  expect(fs.existsSync(path.join(SAMPLE, "replay", "demo.json"))).toBe(true);
});
