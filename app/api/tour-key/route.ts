// The Matterport Showcase SDK key for the in-browser 3D tour. It is public by design (sent with every embed request;
// Matterport restricts it to allowed domains), and read at runtime so no build-time inlining is needed.
export function GET() {
  return Response.json({ key: process.env.MATTERPORTSDKKEY?.trim() || null }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
