// Foot traffic only matters to uses that depend on walk-in customers. Home seekers, warehouses, factories and
// plain offices get the address map without the heat layer. `use` is the useCategory() key.
const NO_WALK_INS = new Set(["home", "warehouse", "manufacturing"]);

export function showsFootTraffic(mode: string, use: string, useType = ""): boolean {
  if (mode === "home" || NO_WALK_INS.has(use)) return false;
  // useCategory() falls back to "office" for anything it doesn't recognize (daycare, dental lab, ...), so only a
  // request that actually says office or coworking counts as one.
  if (use === "office") return !/\b(office|co-?working|headquarters|hq)\b/i.test(useType) && useType.trim() !== "";
  return true;
}
