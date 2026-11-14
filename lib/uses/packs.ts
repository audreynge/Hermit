import table from "../../rules/uses.json";
import { useCategory } from "../reason/rules";
import type { RequirementSpec, RoomReq } from "../types";

export type PackRoom = { label: string; count: number; minSqft?: number; fixtures?: string[]; hard?: boolean; w: number; h: number };
export type Pack = {
  key: string; label: string; rooms: PackRoom[]; fixtures: string[]; hidden: string[];
  critical: Record<string, number>; chips: string[]; priorUse: string[];
};

const PACKS = table.packs as Record<string, Omit<Pack, "key">>;

export function packFor(spec: Pick<RequirementSpec, "useType" | "mode">): Pack {
  const key = spec.mode === "home" ? "home" : useCategory(spec.useType || "office");
  const p = PACKS[key] ?? PACKS.office;
  return { key: PACKS[key] ? key : "office", ...p };
}

// The rooms to search for. An empty list means the pack's typical layout. Rooms the user edited in chat or on the
// sketch are theirs (deleted rooms stay deleted) and only inherit the pack's fixtures. A one-sentence text request
// is partial, so the pack fills in what it didn't mention.
export function seedRooms(spec: Pick<RequirementSpec, "useType" | "mode" | "rooms"> & { input?: RequirementSpec["input"] }): RoomReq[] {
  const pack = packFor(spec);
  const fromPack = (r: PackRoom): RoomReq => { const { w: _w, h: _h, ...rest } = r; return { ...rest, hard: r.hard ?? false }; };
  if (!spec.rooms.length) return pack.rooms.map(fromPack);
  const merged = spec.rooms.map((r) => {
    const p = pack.rooms.find((x) => x.label === r.label);
    return p?.fixtures && !r.fixtures?.length ? { ...r, fixtures: p.fixtures } : r;
  });
  if (spec.input !== "text" && spec.input !== "voice") return merged;
  const have = new Set(spec.rooms.map((r) => r.label));
  return [...merged, ...pack.rooms.filter((r) => !have.has(r.label)).map(fromPack)];
}

export const roomSize = (label: string, pack: Pack) => pack.rooms.find((r) => r.label === label) ?? { w: 10, h: 10 };
