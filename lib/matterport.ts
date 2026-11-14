// Fresh signed Matterport CDN URLs for a scan's preview image or floor plan. They expire (~1 h),
// so they are fetched per request instead of stored.
export async function matterportImageUrl(sid: string, kind: "thumb" | "floorplan", fetchFn: typeof fetch = fetch): Promise<string | null> {
  const key = process.env.MATTERPORTAPIKEY?.trim(), token = process.env.MATTERPORTAPITOKEN?.trim();
  if (!key || !token) return null;
  const query = kind === "thumb"
    ? "query($id: ID!) { model(id: $id) { image { resizeUrl(resolution: preview) } } }"
    : "query($id: ID!) { model(id: $id) { assets { floorplans { url format } } } }";
  try {
    const res = await fetchFn("https://api.matterport.com/api/models/graph", {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${key}:${token}`).toString("base64") },
      body: JSON.stringify({ query, variables: { id: sid } }),
    });
    const m = (await res.json()).data?.model;
    return (kind === "thumb" ? m?.image?.resizeUrl : m?.assets?.floorplans?.find((f: { format: string }) => f.format === "jpg")?.url) ?? null;
  } catch {
    return null;
  }
}
