"use client";
import { useEffect, useState } from "react";
import { getJSON, setJSON } from "@/lib/client/persist";
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

export type PlacedItem = { id: string; roomId: string; type: string; x: number; y: number; w: number; h: number }; // meters, scan coordinates
export const useFurnished = (shellId: string) => usePersisted<PlacedItem[]>(`hermit:furnish:${shellId}`, []);
