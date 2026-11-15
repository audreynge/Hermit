// Merges the Postgres catalog (CoStar fields) with the local scan index (scan fields) into one Shell list.
// Run: npx tsx pipeline/merge-catalog.ts [--env=path/to/.env]
// Reads DATABASE_URL (read-only) and data/processed/shells.json; writes data/processed/shells.merged.json and any
// Postgres room graph that has no local file. Never overwrites shells.json or an existing local room graph.
import fs from "node:fs";
import path from "node:path";
import type { RoomGraph, Shell } from "../lib/types";

// Scan fields the local index carries and the Postgres rows lack. CoStar fields always come from Postgres.
export const SCAN_FIELDS = ["kind", "scanClass", "measuredSqft", "defurnished", "splat", "floorCount", "roomCount", "panoCount"] as const;

const missing = (v: unknown) => v === undefined || v === null;

export type MergeStats = { both: number; remoteOnly: number; localOnly: number; idConflicts: string[] };

// Pure: remote rows win, local scan fields fill gaps. Joins by sid, falling back to id. Keeps rows found on one side only.
export function mergeShells(remote: Shell[], local: Shell[]): { shells: Shell[]; stats: MergeStats } {
  const bySid = new Map<string, number>();
  const byId = new Map<string, number>();
  local.forEach((s, i) => {
    if (s.sid && !bySid.has(s.sid)) bySid.set(s.sid, i);
    if (!byId.has(s.id)) byId.set(s.id, i);
  });
  const used = new Set<number>();
  const take = (i: number | undefined) => (i === undefined || used.has(i) ? undefined : (used.add(i), i));
  const stats: MergeStats = { both: 0, remoteOnly: 0, localOnly: 0, idConflicts: [] };
  const out: Shell[] = [];
  for (const r of remote) {
    const i = take(r.sid ? bySid.get(r.sid) : undefined) ?? take(byId.get(r.id));
    if (i === undefined) { out.push(r); stats.remoteOnly++; continue; }
    const l = local[i];
    const m: Shell = { ...r };
    const rec = m as Record<string, unknown>;
    for (const f of SCAN_FIELDS) if (missing(rec[f]) && !missing(l[f])) rec[f] = l[f];
    if ((missing(m.lat) || missing(m.lon)) && !missing(l.lat) && !missing(l.lon)) { m.lat = l.lat; m.lon = l.lon; }
    out.push(m);
    stats.both++;
  }
  const ids = new Set(out.map((s) => s.id));
  local.forEach((l, i) => {
    if (used.has(i)) return;
    if (ids.has(l.id)) { stats.idConflicts.push(l.id); return; }
    ids.add(l.id);
    out.push(l);
    stats.localOnly++;
  });
  return { shells: out, stats };
}

export const polygonRooms = (g: Pick<RoomGraph, "rooms"> | null | undefined) => (g?.rooms ?? []).filter((r) => (r.polygon?.length ?? 0) >= 3).length;

export type GraphPlan = { write: string[]; overlap: { localBetter: string[]; remoteBetter: string[]; equal: string[] } };

// Pure: which remote graphs to write (no local file) and, for overlapping sids, which side has more rooms with polygons.
export function planRoomGraphs(localGraphs: Map<string, RoomGraph | null>, remoteGraphs: Map<string, RoomGraph | null>): GraphPlan {
  const plan: GraphPlan = { write: [], overlap: { localBetter: [], remoteBetter: [], equal: [] } };
  for (const [sid, rg] of remoteGraphs) {
    if (!localGraphs.has(sid)) { plan.write.push(sid); continue; }
    const a = polygonRooms(localGraphs.get(sid)), b = polygonRooms(rg);
    (a > b ? plan.overlap.localBetter : b > a ? plan.overlap.remoteBetter : plan.overlap.equal).push(sid);
  }
  return plan;
}

export const COVERAGE_KEYS = ["rows", "sprinkler", "heavyPower", "parkingSpaces", "zoning", "listing", "subtype", "propertyType", "kind", "measuredSqft", "lat/lon", "has room graph"] as const;
export type Coverage = Record<(typeof COVERAGE_KEYS)[number], number>;

const known = (v: unknown) => typeof v === "string" && v !== "" && v.toLowerCase() !== "unknown";

export function coverage(shells: Shell[], graphSids: Set<string>): Coverage {
  const n = (f: (s: Shell) => boolean) => shells.filter(f).length;
  return {
    rows: shells.length,
    sprinkler: n((s) => known(s.sprinkler)),
    heavyPower: n((s) => !missing(s.heavyPower)),
    parkingSpaces: n((s) => !missing(s.parkingSpaces)),
    zoning: n((s) => known(s.zoning)),
    listing: n((s) => !missing(s.listing)),
    subtype: n((s) => known(s.subtype)),
    propertyType: n((s) => known(s.propertyType)),
    kind: n((s) => !missing(s.kind)),
    measuredSqft: n((s) => !missing(s.measuredSqft)),
    "lat/lon": n((s) => !missing(s.lat) && !missing(s.lon)),
    "has room graph": n((s) => !!s.sid && graphSids.has(s.sid)),
  };
}

const LABELS: Record<keyof Coverage, string> = {
  rows: "rows", sprinkler: "sprinkler (≠unknown)", heavyPower: "heavyPower", parkingSpaces: "parkingSpaces", zoning: "zoning", listing: "listing",
  subtype: "subtype≠Unknown", propertyType: "propertyType≠Unknown", kind: "kind", measuredSqft: "measuredSqft", "lat/lon": "lat/lon", "has room graph": "has room graph",
};

export function coverageTable(before: Coverage, after: Coverage): string {
  const rows = COVERAGE_KEYS.map((k) => [LABELS[k], String(before[k]), String(after[k])]);
  const w = [Math.max(5, ...rows.map((r) => r[0].length)), Math.max(14, ...rows.map((r) => r[1].length)), Math.max(15, ...rows.map((r) => r[2].length))];
  const line = (c: string[]) => `| ${c[0].padEnd(w[0])} | ${c[1].padStart(w[1])} | ${c[2].padStart(w[2])} |`;
  return [line(["field", "before (local)", "after (merged)"]), `|${"-".repeat(w[0] + 2)}|${"-".repeat(w[1] + 1)}:|${"-".repeat(w[2] + 1)}:|`, ...rows.map(line)].join("\n");
}

// Reads NAME=value lines (tolerating "NAME =value") into process.env without overriding what is already set.
export function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const parse = <T>(j: unknown): T => (typeof j === "string" ? JSON.parse(j) : j) as T;
const SAFE_SID = /^[A-Za-z0-9_-]{1,40}$/;

async function main() {
  const { dataDir } = await import("../lib/paths");
  const { default: postgres } = await import("postgres");
  loadEnvFile(process.argv.find((a) => a.startsWith("--env="))?.slice(6) ?? path.join(process.cwd(), ".env"));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (pass --env=path/to/.env)");
  const dir = dataDir();
  const graphDir = path.join(dir, "roomgraphs");

  const local = JSON.parse(fs.readFileSync(path.join(dir, "shells.json"), "utf8")) as Shell[];
  const localGraphs = new Map<string, RoomGraph | null>();
  if (fs.existsSync(graphDir)) for (const f of fs.readdirSync(graphDir).filter((f) => f.endsWith(".json"))) {
    try { localGraphs.set(f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(graphDir, f), "utf8"))); } catch { localGraphs.set(f.slice(0, -5), null); }
  }

  const sql = postgres(url, { prepare: false, max: 1 });
  let remote: Shell[], remoteGraphRows: { sid: string; json: unknown }[];
  try {
    remote = (await sql`SELECT json FROM shells ORDER BY id`).map((r) => parse<Shell>(r.json));
    remoteGraphRows = (await sql`SELECT sid, json FROM roomgraphs ORDER BY sid`) as unknown as { sid: string; json: unknown }[];
  } finally {
    await sql.end();
  }

  const before = coverage(local, new Set(localGraphs.keys()));
  const { shells, stats } = mergeShells(remote, local);

  const remoteGraphs = new Map<string, RoomGraph | null>();
  const remoteText = new Map<string, string>();
  for (const r of remoteGraphRows) {
    if (!SAFE_SID.test(r.sid)) continue;
    const text = typeof r.json === "string" ? r.json : JSON.stringify(r.json);
    remoteText.set(r.sid, text);
    try { remoteGraphs.set(r.sid, JSON.parse(text)); } catch { remoteGraphs.set(r.sid, null); }
  }
  const plan = planRoomGraphs(localGraphs, remoteGraphs);
  fs.mkdirSync(graphDir, { recursive: true });
  let written = 0;
  for (const sid of plan.write) {
    const file = path.join(graphDir, `${sid}.json`);
    if (fs.existsSync(file)) continue; // never overwrite a local graph
    fs.writeFileSync(file, remoteText.get(sid)!);
    written++;
  }

  const out = path.join(dir, "shells.merged.json");
  fs.writeFileSync(out, JSON.stringify(shells));
  const graphSids = new Set([...localGraphs.keys(), ...remoteGraphs.keys()]);
  console.log(`postgres: ${remote.length} shells, ${remoteGraphRows.length} room graphs; local: ${local.length} shells, ${localGraphs.size} room graphs`);
  console.log(`joined ${stats.both}, postgres-only ${stats.remoteOnly}, local-only ${stats.localOnly}${stats.idConflicts.length ? `, ${stats.idConflicts.length} local rows skipped for id conflicts` : ""}`);
  console.log(`room graphs: wrote ${written} new from postgres; overlap ${plan.overlap.localBetter.length + plan.overlap.remoteBetter.length + plan.overlap.equal.length} ` +
    `(local has more polygon rooms: ${plan.overlap.localBetter.length}, postgres has more: ${plan.overlap.remoteBetter.length}, equal: ${plan.overlap.equal.length})`);
  if (plan.overlap.remoteBetter.length) console.log(`  postgres richer for: ${plan.overlap.remoteBetter.slice(0, 20).join(", ")}${plan.overlap.remoteBetter.length > 20 ? ", …" : ""}`);
  console.log(`\n${coverageTable(before, coverage(shells, graphSids))}\n\nwrote ${out} (${shells.length} shells). shells.json was not changed.`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("pipeline/merge-catalog.ts")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
