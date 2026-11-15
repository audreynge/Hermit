import { NextResponse } from "next/server";
import { z } from "zod";
import { sizeFor } from "@/lib/furnish/sizes";

export const runtime = "nodejs";

// ?name=wheelchair → its typical real-world size (table, else Gemini, cached; else the default, flagged).
const Plain = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);

export async function GET(req: Request) {
  const name = Plain.safeParse(new URL(req.url).searchParams.get("name"));
  if (!name.success) return NextResponse.json({ error: "give a plain item name" }, { status: 400 });
  return NextResponse.json(await sizeFor(name.data), { headers: { "Cache-Control": "private, max-age=86400" } });
}
