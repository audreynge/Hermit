import fs from "node:fs";
import path from "node:path";
import { db, dbFile, generation } from "../db";
import { dataDir } from "../paths";
import { importBundle } from "../../pipeline/import-db";
import { isPlaceholderContact, tidyAddress } from "../../pipeline/transform";
import type { City, Mode, RoomGraph, Shell } from "../types";

export { dataDir };
export const isSafeId = (id: string) => /^[A-Za-z0-9_-]{1,40}$/.test(id);

let cache: { key: string; shells: Shell[]; byId: Map<string, Shell> } | null = null;

export function ensureImported() {
  const { n } = db().prepare("SELECT count(*) AS n FROM shells").get() as { n: number };
  if (!n && fs.existsSync(path.join(dataDir(), "shells.json"))) importBundle(dataDir());
}

function table() {
  ensureImported();
  const key = `${dbFile()}#${generation()}`;
  if (cache?.key !== key) {
    const rows = db().prepare("SELECT json FROM shells").all() as { json: string }[];
    const shells: Shell[] = rows.map((r) => {
      const s = JSON.parse(r.json) as Shell;
      if (s.listing?.contact && isPlaceholderContact(s.listing.contact.name)) delete s.listing.contact;
      s.address = tidyAddress(s.address);
      return s;
    });
    cache = { key, shells, byId: new Map(shells.map((s) => [s.id, s])) };
  }
  return cache;
}

export const loadShells = () => table().shells;
export const getShell = (id: string) => table().byId.get(id) ?? null;

export function searchCandidates(city: City, modes: Mode[]): Shell[] {
  return table().shells.filter((s) => s.city === city && modes.includes(s.mode));
}

export function loadRoomGraph(sid: string): RoomGraph | null {
  if (!isSafeId(sid)) return null;
  ensureImported();
  const row = db().prepare("SELECT json FROM roomgraphs WHERE sid = ?").get(sid) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : null;
}
