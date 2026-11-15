import { NextResponse } from "next/server";
import { z } from "zod";
import { rankModels, searchModels } from "@/lib/furnish/search";
import { sizeFor } from "@/lib/furnish/sizes";

export const runtime = "nodejs";
export const maxDuration = 30;

// ?terms=commercial range,stove[&name=commercial range] → up to 5 models, measured and ranked by fit to the item's
// real size (when a name is given, its size comes back too). Inputs are validated so the route can't spend quota on junk.
const Plain = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);
const Terms = z.array(Plain).min(1).max(3);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const terms = Terms.safeParse((q.get("terms") ?? "").split(",").filter(Boolean));
  const name = q.get("name") ? Plain.safeParse(q.get("name")) : null;
  if (!terms.success || (name && !name.success)) return NextResponse.json({ error: "give 1–3 plain search terms and an optional plain name" }, { status: 400 });
  const [found, sized] = await Promise.all([searchModels(terms.data, 8), name?.success ? sizeFor(name.data) : Promise.resolve(null)]);
  const models = (await rankModels(found, sized?.size ?? null)).slice(0, 5);
  return NextResponse.json({ models, ...(sized && { size: sized.size, sizeSource: sized.source }) }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
