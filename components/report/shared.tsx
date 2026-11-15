"use client";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getJSON, setJSON } from "@/lib/client/persist";
import type { Placed } from "@/lib/furnish/ops";
import { migrate, type Footprint } from "@/lib/furnish/footprint";
import type { MoneyInputs } from "@/lib/money";
import type { Evidence, RequirementSpec, ShellReport } from "@/lib/types";

export function SourceChip({ e }: { e: Evidence | string }) {
  const ev = typeof e === "string" ? { source: e.split(" ")[0], ref: e, confidence: 0.5 } : e;
  return <span className="source-chip" title={ev.ref} tabIndex={0}>{ev.source}<span className="sr-only">: {ev.ref}</span></span>;
}

// A value saved per shell in this browser, loaded after mount so server and client render the same first frame.
export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void, boolean] {
  const [v, setV] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setV(getJSON(key, initial)); setLoaded(true); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, (x: T) => { setV(x); setJSON(key, x); }, loaded];
}

export type MoneyState = MoneyInputs & { rentKnown: boolean; buyPrice?: number };

export function moneyDefaults(spec: RequirementSpec, report: ShellReport): MoneyState {
  const sqft = report.sqft ?? report.floorplan?.totalAreaSqft ?? 0;
  const rate = report.listing?.askingRate;
  const rent = rate && sqft ? Math.round((rate * sqft) / 12) : 0;
  return { price: spec.avgPrice ?? 0, daysPerWeek: spec.daysOpen ?? 6, rent, utilities: sqft ? Math.round((sqft * 2) / 12) : 0, other: 0, rentKnown: !!rent };
}

export const useMoney = (spec: RequirementSpec, report: ShellReport) => usePersisted<MoneyState>(`hermit:money:${report.shellId}`, moneyDefaults(spec, report));

export type PlacedItem = Footprint; // what the 2D plan draws: meters, scan coordinates

/** Where a scan's furniture is saved in this browser: one list per scan (the shell id when there's no scan). */
export const furnishKey = (shellId: string, sid?: string) => `hermit:furnish:${sid || shellId}`;
const FURNISH_EVENT = "hermit:furnish-changed";

// The furniture both the 2D plan and the 3D tour edit: one list per scan, in localStorage, loaded on mount and saved on
// every change. A real React setter, so the tour's functional updates (setItems((cur) => ...)) work. Older saves (2D
// placements, saves under the shell id, items without pitch/roll) are converted on load. Every mounted copy of this
// hook (report tab, property viewer, packet) hears the others' saves, so none writes back a stale list.
export function useFurnished(shellId: string, sid?: string): [Placed[], Dispatch<SetStateAction<Placed[]>>, boolean] {
  const key = furnishKey(shellId, sid);
  const [state, setState] = useState<{ key: string | null; items: Placed[] }>({ key: null, items: [] });
  const [me] = useState(() => Math.random().toString(36).slice(2));
  // The latest list, so a change is saved the moment it's made (leaving the tab right after can't lose it).
  const latest = useRef(state);
  latest.current = state;
  const show = useCallback((s: typeof state) => { latest.current = s; setState(s); }, []);
  useEffect(() => {
    const read = () => {
      let v = migrate(getJSON<unknown>(key, []));
      if (!v.length && sid && sid !== shellId) v = migrate(getJSON<unknown>(`hermit:furnish:${shellId}`, []));
      return v;
    };
    show({ key, items: read() });
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; from: string }>).detail;
      if (d?.key === key && d.from !== me) show({ key, items: read() });
    };
    const onStorage = (e: StorageEvent) => { if (e.key === key) show({ key, items: read() }); }; // another browser tab
    window.addEventListener(FURNISH_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(FURNISH_EVENT, onChange); window.removeEventListener("storage", onStorage); };
  }, [key, sid, shellId, me, show]);
  const loaded = state.key === key; // never save one scan's list under another scan's key
  const setItems = useCallback<Dispatch<SetStateAction<Placed[]>>>((next) => {
    const cur = latest.current;
    const items = typeof next === "function" ? next(cur.items) : next;
    show({ ...cur, items });
    if (!cur.key) return; // not loaded yet: nothing to save over
    setJSON(cur.key, items);
    window.dispatchEvent(new CustomEvent(FURNISH_EVENT, { detail: { key: cur.key, from: me } }));
  }, [me, show]);
  return [loaded ? state.items : [], setItems, loaded];
}
