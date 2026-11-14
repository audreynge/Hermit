// Runs once per server instance before it handles requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { hydrateCatalogFromPostgres } = await import("./lib/db/catalog");
  const t = Date.now();
  try {
    const n = await hydrateCatalogFromPostgres();
    if (n) console.log(`[hermit] catalog loaded from Postgres: ${n.shells} shells, ${n.roomgraphs} room graphs in ${Date.now() - t}ms`);
  } catch (e) {
    // Keep serving with the bundled sample rather than failing every request.
    console.error(`[hermit] catalog load from Postgres failed: ${e instanceof Error ? e.message : e}`);
  }
}
