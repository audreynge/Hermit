import type { Block } from "../spec/parse";
import { KEYS, load, save } from "./store";

// Layouts the user saved in Layout Studio, kept on this device.
export type SavedLayout = { id: string; name: string; items: Block[]; savedAt: string };

export const loadLayouts = () => load<SavedLayout[]>(KEYS.layouts, "local") ?? [];

/** Creates (no id) or replaces a saved layout; returns its id. */
export function putLayout(l: { id?: string; name: string; items: Block[] }): string {
  const id = l.id ?? `L${Date.now().toString(36)}`;
  const rest = loadLayouts().filter((x) => x.id !== id);
  save(KEYS.layouts, [{ id, name: l.name.trim() || "My layout", items: l.items, savedAt: new Date().toISOString() }, ...rest], "local");
  return id;
}

export const removeLayout = (id: string) => save(KEYS.layouts, loadLayouts().filter((x) => x.id !== id), "local");
