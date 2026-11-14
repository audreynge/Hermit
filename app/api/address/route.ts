import { NextResponse } from "next/server";
import { z } from "zod";
import { demographicsAt } from "@/lib/neighborhood/acs";
import { km, siteAt } from "@/lib/neighborhood/build";
import { geocode } from "@/lib/neighborhood/geocode";
import { competitors, customers, neighbors } from "@/lib/neighborhood/summarize";
import { loadShells } from "@/lib/query/load";
import { useCategory } from "@/lib/reason/rules";
import type { Shell } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({ address: z.string().min(4).max(200), use: z.string().max(60).default("office"), likes: z.array(z.string().max(40)).max(50).default([]) });
const cityOf = (lat: number, lon: number) => (lon > -105 ? (lat > 29 && lat < 30.6 ? "houston" : null) : lat > 33.4 && lat < 34.8 ? "los_angeles" : null);
const BUSINESS = new Set(["suite", "office", "medical", "salon", "retail", "warehouse"]);

// Check an address: geocode with the Census geocoder, describe the neighborhood from cached public data, and list
// the nearest scanned shells. If none are close, rank shells like the ones the user saved ("based on what you like").
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type a street address." }, { status: 400 });
  const { address, use, likes } = parsed.data;
  const g = await geocode(address);
  const match = g ? { lat: g.lat, lon: g.lon, label: g.approximate ? `${g.label} (approximate location)` : g.label } : null;
  if (!match) return NextResponse.json({ error: "I couldn't find that address. Try adding the city and ZIP." }, { status: 404 });
  const city = cityOf(match.lat, match.lon);
  if (!city) return NextResponse.json({ error: `${match.label} is outside Houston and Los Angeles, where Hermit has data.` }, { status: 422 });

  const site = { ...siteAt(match.lat, match.lon, city), demographics: await demographicsAt(match.lat, match.lon) };
  const cat = useCategory(use);
  const shells = loadShells().filter((s) => s.city === city && s.lat != null && s.lon != null && s.sid && BUSINESS.has(s.kind ?? ""));
  const near = shells.map((s) => ({ s, km: km(match!, { lat: s.lat!, lon: s.lon! }) })).sort((a, b) => a.km - b.km).slice(0, 6);
  const liked = loadShells().filter((s) => likes.includes(s.id));
  const like = (s: Shell) => liked.reduce((best, l) => Math.max(best,
    (s.useTags.some((t) => l.useTags.includes(t)) ? 2 : 0) + (s.kind === l.kind ? 1 : 0) +
    (s.measuredSqft && l.measuredSqft ? Math.max(0, 1 - Math.abs(s.measuredSqft - l.measuredSqft) / l.measuredSqft) : 0) +
    (s.roomCount && l.roomCount ? Math.max(0, 1 - Math.abs(s.roomCount - l.roomCount) / Math.max(l.roomCount, 1)) : 0)), 0);
  const similar = liked.length ? shells.filter((s) => !likes.includes(s.id)).map((s) => ({ s, score: like(s) + (s.useTags.includes(cat) ? 1 : 0) })).sort((a, b) => b.score - a.score).slice(0, 4) : [];
  const card = (s: Shell, extra: object) => ({ id: s.id, sid: s.sid, name: s.name, address: s.address, sqft: s.measuredSqft ?? s.sqft, kind: s.kind, lat: s.lat, lon: s.lon, ...extra });
  return NextResponse.json({
    match, city,
    answers: { customers: customers(site), neighbors: neighbors(site), competitors: competitors(site, cat) },
    nearest: near.map(({ s, km: d }) => card(s, { miles: Math.round(d * 0.621 * 10) / 10 })),
    similar: similar.map(({ s }) => card(s, {})),
  });
}
