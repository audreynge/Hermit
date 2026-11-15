import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { dataDir, getShell, isSafeId, loadShells } from "@/lib/query/load";
import type { AerialCount } from "@/lib/types";
import { aerialWriteDir, countAerial, loadAerialCount } from "@/lib/vexcel/count";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const today = () => new Date().toISOString().slice(0, 10);
const counted = (a: AerialCount) => a.stalls.n !== null && a.stalls.confidence >= 0.5;
// A saved count is fresh when it has a number, or when it was tried today (a "couldn't count" from today stays put).
const fresh = (a: AerialCount | null): a is AerialCount => !!a && (counted(a) || a.retrieved >= today());

// One count in flight per space, and at most one new count per space per minute, so reloads and double clicks
// can't spend the vision quota.
const inflight = new Map<string, Promise<AerialCount | null>>();
const lastTry = new Map<string, number>();
const GUARD_MS = 60_000;

const shellFor = (sid: string) => getShell(sid) ?? loadShells().find((s) => s.sid === sid) ?? null;

// Counts parking stalls and rooftop units on the Vexcel aerial photo of a space, live, when no fresh count is saved.
// Keys (Vexcel, Gemini) stay on the server. Body: none. Returns { count, live } or { error, message }.
export async function POST(_req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  if (!isSafeId(sid)) return NextResponse.json({ error: "bad_id", message: "That isn't a space Hermit knows." }, { status: 400 });
  const saved = loadAerialCount(sid);
  if (fresh(saved)) return NextResponse.json({ count: saved, live: false });
  const shell = shellFor(sid);
  if (!shell) return NextResponse.json({ error: "not_found", message: "That isn't a space Hermit knows." }, { status: 404 });
  if (typeof shell.lat !== "number" || typeof shell.lon !== "number" || !Number.isFinite(shell.lat) || !Number.isFinite(shell.lon)) {
    return NextResponse.json({ error: "no_location", message: "This space has no map location, so there's no aerial photo to count." }, { status: 422 });
  }
  let p = inflight.get(sid);
  if (!p) {
    const since = Date.now() - (lastTry.get(sid) ?? 0);
    if (since < GUARD_MS) {
      const wait = Math.ceil((GUARD_MS - since) / 1000);
      return NextResponse.json({ error: "rate_limited", message: "Hermit just tried counting this one. Try again in a minute.", count: saved }, { status: 429, headers: { "Retry-After": String(wait) } });
    }
    lastTry.set(sid, Date.now());
    p = countAerial(sid, shell.lat, shell.lon, { backoffMs: 1500, timeoutMs: 40_000 }).finally(() => inflight.delete(sid));
    inflight.set(sid, p);
  }
  try {
    const count = await p;
    if (!count) return NextResponse.json({ error: "no_photo", message: "Vexcel has no aerial photo of this spot to count." }, { status: 404 });
    return NextResponse.json({ count, live: true });
  } catch (e) {
    console.warn(`aerial count ${sid} failed: ${(e as Error).message.slice(0, 200)}`);
    return NextResponse.json({ error: "count_failed", message: "Couldn't count the parking from the photo right now." }, { status: 502 });
  }
}

// The photo a count was made on. A live count on Vercel sits in /tmp, which app/api/asset doesn't read.
export async function GET(_req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  if (!isSafeId(sid)) return new Response("not found", { status: 404 });
  const file = [aerialWriteDir(), path.join(dataDir(), "aerial")].map((d) => path.join(d, `${sid}.jpg`)).find((f) => fs.existsSync(f));
  if (!file) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
