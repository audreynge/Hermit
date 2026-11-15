import { NextResponse } from "next/server";
import { geocode } from "@/lib/neighborhood/geocode";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 4 || q.length > 200) return NextResponse.json({ error: "Missing address." }, { status: 400 });
  const g = await geocode(q);
  return g ? NextResponse.json(g) : NextResponse.json({ error: "Address not found." }, { status: 404 });
}
