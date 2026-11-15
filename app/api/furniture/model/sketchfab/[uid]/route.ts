import { sketchfabDownloadUrl } from "@/lib/furnish/search";

export const runtime = "nodejs";

// Stable model URL for saved layouts: redirects to a fresh signed Sketchfab download (those expire after 5 minutes).
export async function GET(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!/^[0-9a-f]{32}$/.test(uid)) return new Response("not found", { status: 404 });
  const url = await sketchfabDownloadUrl(uid);
  if (!url) return new Response("model unavailable", { status: 502 });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}
