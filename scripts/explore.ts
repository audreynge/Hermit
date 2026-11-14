// Drives /api/chat, /api/design and /api/agent through scripted personas and checks invariants.
// Run: npm run explore -- --base http://localhost:3000
import fs from "node:fs";
import path from "node:path";
import type { RequirementSpec, ShellReport, TraceEvent } from "../lib/types";

type Turn = { reply: string; ready: boolean; quickReplies: string[]; card?: { options: { label: string }[] }; state: { spec: RequirementSpec } };
type Persona = { name: string; say: string[]; then?: "tap" | "idk" | "none"; design?: unknown[] };

const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const LONG = "We run a small family practice ".repeat(60);
const BAD = /\bundefined\b|\bNaN\b|\[object /;

const PERSONAS: Persona[] = [
  { name: "nail salon LA $4k", say: ["Nail salon in Los Angeles, about 1,000 sq ft, $4,000/month"], then: "tap" },
  { name: "coffee shop Houston hood", say: ["Opening a coffee shop in Houston, need a hood, 1,200-2,000 sq ft"], then: "tap" },
  { name: "dentist ADA", say: ["Dentist office with 4 operatories, wheelchair accessible, Houston, 2,000-3,000 sf"], then: "tap" },
  { name: "yoga studio", say: ["yoga studio with 2 rooms in LA"], then: "tap" },
  { name: "3PL warehouse", say: ["3PL warehouse in Los Angeles, 20,000 sf, ESFR sprinklers and dock doors"], then: "tap" },
  { name: "first home", say: ["first home to buy, 3 bed 2 bath in Houston under $400k"], then: "tap" },
  { name: "just hi", say: ["hi"], then: "idk" },
  { name: "contradicts", say: ["a salon in Houston", "actually make it an office in Los Angeles"], then: "tap" },
  { name: "idk everything", say: ["idk"], then: "idk" },
  { name: "very long paste", say: [LONG.slice(0, 1900)], then: "idk" },
  { name: "taps everything", say: ["Medical / dental clinic"], then: "tap" },
  { name: "just search", say: ["office in Houston", "just search"], then: "none" },
  { name: "bakery LA", say: ["bakery in LA with a commercial kitchen, 1,500 sq ft"], then: "tap" },
  { name: "retail buy", say: ["We want to purchase a small retail shop in Houston"], then: "tap" },
  { name: "gym big", say: ["boxing gym, 5,000-8,000 sq ft, Los Angeles, needs showers"], then: "tap" },
  { name: "law office", say: ["law office for 12 people in Houston, needs a conference room"], then: "tap" },
  { name: "vet clinic", say: ["veterinary clinic in Los Angeles"], then: "tap" },
  { name: "only city", say: ["Houston"], then: "tap" },
  { name: "emoji and punctuation", say: ["??? 🙂 !!!"], then: "idk" },
  { name: "numbers only", say: ["2500"], then: "idk" },
  { name: "permits question first", say: ["salon in Houston", "what permits do I need?"], then: "tap" },
  { name: "bigger after results", say: ["small medical clinic in Houston, 1,200-1,800 sq ft, 3 exam rooms and a reception"], then: "none" },
  { name: "drawn clinic", say: [], then: "tap", design: [
    { id: "a", label: "reception", x: 0, y: 0, w: 20, h: 10 }, { id: "b", label: "exam room", x: 0, y: 10, w: 10, h: 10 },
    { id: "c", label: "exam room", x: 10, y: 10, w: 10, h: 10 }, { id: "s", label: "sink", kind: "object", x: 2, y: 12, w: 2, h: 2 }] },
  { name: "drawn tiny", say: [], then: "idk", design: [{ id: "a", label: "office", x: 0, y: 0, w: 8, h: 8 }] },
  { name: "home rental", say: ["2 bedroom apartment to rent in Los Angeles under $3,000 a month"], then: "tap" },
];

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}

async function search(spec: RequirementSpec) {
  const t0 = Date.now();
  const res = await call("POST", "/api/agent", spec);
  const text = await res.text();
  const events = text.split("\n\n").filter((p) => p.startsWith("data: ")).map((p) => JSON.parse(p.slice(6)) as TraceEvent);
  return { status: res.status, ms: Date.now() - t0, events };
}

async function runPersona(p: Persona) {
  const problems: string[] = [];
  const check = (cond: boolean, msg: string) => { if (!cond) problems.push(msg); };
  let res = await call("POST", "/api/chat", { open: true, spec: { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" } });
  check(res.status < 500, `open → ${res.status}`);
  let { conversationId, turn } = (await res.json()) as { conversationId: string; turn: Turn };
  const replies = [turn.reply];
  let userTurns = 0;
  if (p.design) {
    res = await call("POST", "/api/design", { conversationId, blocks: p.design });
    check(res.status < 500, `design → ${res.status}`);
    turn = ((await res.json()) as { turn: Turn }).turn;
    replies.push(turn.reply);
    userTurns++;
  }
  const queue = [...p.say];
  while (!turn.ready && userTurns < 8) {
    const next = queue.shift() ?? (p.then === "tap" ? (turn.card ? turn.card.options[0].label : turn.quickReplies[0] ?? "just search") : p.then === "idk" ? "idk" : "just search");
    res = await call("POST", "/api/chat", { conversationId, text: next });
    check(res.status < 500, `chat "${next.slice(0, 30)}" → ${res.status}`);
    if (res.status >= 400) break;
    turn = ((await res.json()) as { turn: Turn }).turn;
    replies.push(turn.reply);
    userTurns++;
    if (turn.ready && queue.length) break;
  }
  check(turn.ready, `never ready after ${userTurns} user turns`);
  check(userTurns <= 6, `took ${userTurns} user turns to search`);
  for (const r of replies) check(!BAD.test(r), `bad text in reply: "${r.slice(0, 80)}"`);

  let reports: ShellReport[] = [];
  if (turn.ready) {
    const s = await search(turn.state.spec);
    check(s.status < 500, `agent → ${s.status}`);
    check(s.ms < 45_000, `search took ${s.ms} ms`);
    check(!s.events.some((e) => e.type === "error"), `agent error event`);
    reports = (s.events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }> | undefined)?.reports ?? [];
    for (const r of reports) {
      check(r.sources.length > 0, `${r.shellId}: no sources`);
      for (const h of r.rules) if (h.rule.startsWith("reg_")) check(h.citation.startsWith("https://"), `${r.shellId}: ${h.rule} citation ${h.citation}`);
      const claims = [r.summary, r.verdict, ...r.reasons].join(" ");
      if (r.listing?.status !== "active") check(!/\bavailable now\b|\bis available\b/i.test(claims), `${r.shellId}: availability claim without active listing`);
      check(!BAD.test(JSON.stringify([r.summary, r.verdict, r.reasons, r.draftMessage])), `${r.shellId}: bad text in report`);
    }
  }
  if (p.name === "permits question first" || p.name === "bigger after results") {
    const follow = p.name === "bigger after results" ? "Make it bigger" : "what permits do I need?";
    res = await call("POST", "/api/chat", { conversationId, text: follow });
    check(res.status < 500, `follow-up → ${res.status}`);
    const t = ((await res.json()) as { turn: Turn & { action?: string } }).turn;
    if (p.name === "bigger after results") check(t.ready, "Make it bigger did not re-search");
    else check(t.action === "regulations", "permit question did not route to regulations");
  }
  return { name: p.name, userTurns, reports: reports.length, problems };
}

async function main() {
  const out = [];
  for (const p of PERSONAS) {
    cookie = "";
    try {
      out.push(await runPersona(p));
    } catch (e) {
      out.push({ name: p.name, userTurns: 0, reports: 0, problems: [`crashed: ${e instanceof Error ? e.message : e}`] });
    }
    const last = out.at(-1)!;
    console.log(`${last.problems.length ? "✘" : "✓"} ${last.name.padEnd(24)} turns=${last.userTurns} reports=${last.reports}${last.problems.length ? `  ${last.problems.join(" | ")}` : ""}`);
  }
  fs.mkdirSync(path.join(process.cwd(), "test-results"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "test-results", "explore.json"), JSON.stringify(out, null, 2));
  const failed = out.filter((o) => o.problems.length);
  console.log(`\n${out.length - failed.length}/${out.length} personas clean`);
  process.exit(failed.length ? 1 : 0);
}

main();
