import { getShell, isSafeId } from "@/lib/query/load";
import { isVexcelView, vexcelImage } from "@/lib/vexcel/client";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = new URL(req.url).searchParams.get("view") ?? "ortho";
  const shell = isSafeId(id) ? getShell(id) : null;
  if (!shell || shell.lat == null || shell.lon == null || !isVexcelView(view)) return new Response("not found", { status: 404 });
  const img = await vexcelImage(shell.lat, shell.lon, view);
  if (!img) return new Response("no imagery", { status: 404 });
  return new Response(new Uint8Array(img), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
