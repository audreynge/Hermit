import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const IMPORT = /^\s*import\s+(?!type\b)(?:[^'"]*from\s+)?["']([^"']+)["']/gm;

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  return null;
}

// Walks value imports (type-only imports are erased) from every client component.
it("client components never pull in the database or node: modules", () => {
  const clientFiles = fs.readdirSync(path.join(ROOT, "components")).map((f) => path.join(ROOT, "components", f))
    .filter((f) => fs.readFileSync(f, "utf8").startsWith('"use client"'));
  const bad: string[] = [];
  for (const entry of clientFiles) {
    const seen = new Set<string>();
    const walk = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const [, spec] of fs.readFileSync(file, "utf8").matchAll(IMPORT)) {
        if (spec.startsWith("node:") || ["fs", "path", "crypto"].includes(spec)) bad.push([...chain, file, spec].map((p) => path.relative(ROOT, p) || p).join(" → "));
        const next = resolve(file, spec);
        if (next && next.endsWith(".json")) continue;
        if (next) walk(next, [...chain, file]);
      }
    };
    walk(entry, []);
  }
  expect(bad).toEqual([]);
});
