import fs from "node:fs";
import path from "node:path";
import { dataDir, isSafeId } from "@/lib/query/load";

export async function GET(_req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  if (!isSafeId(sid)) return new Response("not found", { status: 404 });
  const file = path.join(dataDir(), "thumbs", `${sid}.jpg`);
  if (!fs.existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
