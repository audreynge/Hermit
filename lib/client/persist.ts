"use client";
import type { ShellReport } from "../types";

// Per-viewer persistence for the demo: favorites, messages, furniture, tour notes and money inputs.
export function getJSON<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function setJSON(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: the page still works for this view */ }
}

export type SavedShell = { shellId: string; runId: string; name: string; address: string; matchScore: number; verdict: string; sid?: string; lat?: number; lon?: number; useTags?: string[]; sqft?: number; savedAt: string };
const SAVED = "hermit:saved2";
export const savedShells = () => getJSON<SavedShell[]>(SAVED, []);
export const isSaved = (id: string) => savedShells().some((s) => s.shellId === id);
export function toggleSaved(r: ShellReport, runId: string): boolean {
  const all = savedShells();
  if (all.some((s) => s.shellId === r.shellId)) { setJSON(SAVED, all.filter((s) => s.shellId !== r.shellId)); return false; }
  setJSON(SAVED, [...all, { shellId: r.shellId, runId, name: r.name, address: r.address, matchScore: r.matchScore, verdict: r.verdict, sid: r.inside?.sid, lat: r.above?.lat, lon: r.above?.lon, useTags: r.useTags, sqft: r.sqft, savedAt: new Date().toISOString() }]);
  return true;
}

export type Thread = { id: string; shellId: string; runId: string; name: string; to: string; subject: string; body: string; status: "draft" | "sent-by-you"; updatedAt: string; sample?: boolean; reply?: string };
const INBOX = "hermit:inbox";
export const threads = () => getJSON<Thread[]>(INBOX, []);
export function saveThread(t: Thread) { setJSON(INBOX, [t, ...threads().filter((x) => x.id !== t.id)]); }
export function removeThread(id: string) { setJSON(INBOX, threads().filter((x) => x.id !== id)); }
