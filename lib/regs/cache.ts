import { db } from "../db";

export function getCached<T>(key: string): T | null {
  const r = db().prepare("SELECT json, expires_at FROM regulation_findings WHERE cache_key = ?").get(key) as { json: string; expires_at: string } | undefined;
  return r && r.expires_at > new Date().toISOString() ? (JSON.parse(r.json) as T) : null;
}

export function putCached(key: string, value: unknown, days: number) {
  const now = new Date();
  db().prepare("INSERT OR REPLACE INTO regulation_findings (cache_key, json, fetched_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(key, JSON.stringify(value), now.toISOString(), new Date(now.getTime() + days * 864e5).toISOString());
}
