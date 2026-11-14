// Per-viewer browser storage. Every access is guarded: storage can be missing or throw (private mode, blocked site data).
export function load<T>(key: string, store: "session" | "local" = "session"): T | null {
  try {
    const raw = (store === "session" ? sessionStorage : localStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown, store: "session" | "local" = "session") {
  try {
    (store === "session" ? sessionStorage : localStorage).setItem(key, JSON.stringify(value));
  } catch {
    // non-essential: the flow still works for this page view
  }
}

export function drop(key: string, store: "session" | "local" = "session") {
  try {
    (store === "session" ? sessionStorage : localStorage).removeItem(key);
  } catch {}
}

export const KEYS = { layout: "hermit:layout" };
