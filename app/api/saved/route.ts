import { NextResponse } from "next/server";
import { z } from "zod";
import { listSaved, saveSpace, unsaveSpace } from "@/lib/db/conversations";
import { viewerId } from "@/lib/server/viewer";

export async function GET() {
  return NextResponse.json(listSaved(await viewerId()));
}

const Body = z.object({ report: z.object({ shellId: z.string().min(1).max(40) }).passthrough(), spec: z.object({}).passthrough() });

export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: b.error.issues }, { status: 400 });
  saveSpace(await viewerId(), b.data.report as never, b.data.spec as never);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("shellId") ?? "";
  unsaveSpace(await viewerId(), id);
  return NextResponse.json({ ok: true });
}
