import { q } from "../db";

export async function getCached<T>(key: string): Promise<T | null> {
  const [r] = await q<{ json: string; expires_at: string }>("SELECT json, expires_at FROM regulation_findings WHERE cache_key = ?", [key]);
  return r && r.expires_at > new Date().toISOString() ? (JSON.parse(r.json) as T) : null;
}

export async function putCached(key: string, value: unknown, days: number) {
  const now = new Date();
  await q(`INSERT INTO regulation_findings (cache_key, json, fetched_at, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (cache_key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, JSON.stringify(value), now.toISOString(), new Date(now.getTime() + days * 864e5).toISOString()]);
}
