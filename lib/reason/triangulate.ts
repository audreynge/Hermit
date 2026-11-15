import { aerialCounted, aerialRooftop, parkingNeed, useCategory } from "./rules";
import { CLASS_USE } from "../query/shells";
import type { AerialCount, Layer, RequirementSpec, RoomGraph, Shell, TriRow } from "../types";

type Cell = TriRow["cells"][Layer];
const absent = (note: string): Cell => ({ state: "absent", note });
const agree = (note: string): Cell => ({ state: "agree", note });
const disagree = (note: string): Cell => ({ state: "disagree", note });

const USE_WORDS: Record<string, RegExp> = {
  medical: /medical|clinic|exam|patient|healthcare|dental/i, salon: /salon|styling|shampoo|spa/i, office: /office|workspace|conference|desk/i,
  retail: /retail|storefront|display|showroom/i, restaurant: /kitchen|dining|restaurant|hood/i, warehouse: /warehouse|loading|dock|industrial|roll-up/i,
  fitness: /fitness|gym|studio|locker/i, manufacturing: /industrial|warehouse|shop floor/i, home: /bedroom|living|kitchen/i,
};

function verdict(cells: TriRow["cells"]): TriRow["verdict"] {
  const v = Object.values(cells);
  const a = v.filter((c) => c.state === "agree").length, d = v.filter((c) => c.state === "disagree").length;
  if (a && d) return "conflict";
  if (a >= 2) return "confirmed";
  if (a === 1) return "single-source";
  return d ? "single-source" : "unknown"; // one layer saying "not seen" is evidence, not a conflict
}

// A claim is confirmed only when two independent layers agree; disagreements are surfaced, never averaged away.
export function triangulate(spec: RequirementSpec, shell: Shell, graph: RoomGraph | null, aerial: AerialCount | null = null): TriRow[] {
  const use = useCategory(spec.useType);
  const desc = graph?.description ?? "";
  const rows: TriRow[] = [];
  const add = (claim: string, cells: TriRow["cells"], detail: string) => rows.push({ claim, cells, verdict: verdict(cells), detail });
  const recordNote = shell.propertyId ? `CoStar property ${shell.propertyId}: not on the record` : "No CoStar record linked";

  // Prior use
  const nameSays = USE_WORDS[use]?.test(shell.name);
  const classUse = graph?.classification ? CLASS_USE[graph.classification] : undefined;
  const descSays = USE_WORDS[use]?.test(desc);
  add(`Built for ${use}`, {
    costar: shell.subtype !== "Unknown" ? (shell.useTags.includes(use) ? agree(`Subtype ${shell.subtype}`) : disagree(`Subtype ${shell.subtype}`)) : nameSays ? agree(`Listing name "${shell.name}"`) : absent(recordNote),
    matterport: classUse ? (classUse === use ? agree(`Vision classification: ${graph!.classification}`) : disagree(`Vision classification: ${graph!.classification!.replace(/_/g, " ")}`)) : descSays ? agree("Scan description mentions it") : absent("No classification"),
    aerial: absent("Use can't be seen from above"),
  }, classUse && classUse !== use && nameSays ? `The name says ${use}, but Matterport's vision model reads the scan as ${graph!.classification!.replace(/_/g, " ")}.` : "Prior use sets the starting belief; the scan confirms or overrides it.");

  // Size
  const advertised = shell.sqftSource === "scan name" ? shell.sqft : undefined;
  const measured = graph && graph.totalAreaSqft > 30 ? Math.round(graph.totalAreaSqft) : undefined;
  if (advertised || measured) {
    const gap = advertised && measured ? Math.abs(advertised - measured) / advertised : 0;
    add("Size", {
      costar: advertised ? agree(`Advertised ${advertised.toLocaleString()} sf`) : absent(recordNote),
      matterport: measured ? (advertised && gap > 0.25 ? disagree(`Measured ${measured.toLocaleString()} sf net`) : agree(`Measured ${measured.toLocaleString()} sf net`)) : absent("Not measured"),
      aerial: absent("Footprint not measured from the aerial"),
    }, advertised && measured && gap > 0.25 ? `A ${Math.round(gap * 100)}% discrepancy between the advertised and measured size. Ask whether the scan covers the whole suite.` : "Net measured area runs below gross leasable area; that's normal.");
  }

  // Restroom
  if (graph) {
    const tagged = graph.rooms.some((r) => r.label === "bathroom");
    const mentioned = /restroom|bathroom|toilet|lavatory|\bwc\b/i.test(desc);
    add("Restroom in the space", {
      costar: absent(recordNote),
      matterport: tagged ? agree("Room tagged bathroom") : mentioned ? agree("Description mentions a restroom (room tags don't)") : disagree("No restroom tagged or described"),
      aerial: absent("Not visible from above"),
    }, tagged && mentioned ? "Tag and description agree inside the scan; still one layer." : "A restroom shared in the building corridor won't show in a suite scan.");
  }

  // Step-free
  if (spec.needs.wheelchair || spec.needs.stepFree) {
    const floors = graph?.floorCount ?? shell.floorCount;
    add("Step-free route", {
      costar: shell.elevator === true ? agree("Elevator on record") : shell.elevator === false ? disagree("No elevator on record") : absent(recordNote),
      matterport: floors == null ? absent("No scan") : floors > 1 ? disagree(`${floors} floors in the scan`) : /stairs|steps/i.test(desc) ? disagree("Description mentions stairs") : agree("Single floor, no stairs described"),
      aerial: absent("Entry grade not visible from above"),
    }, "Entry thresholds and restroom turning space still need a site check.");
  }

  // Parking: the CoStar record against stalls counted on the Vexcel aerial, both judged against the same need.
  const need = parkingNeed(spec, shell, graph);
  const rec = shell.parkingSpaces;
  const counted = aerialCounted(aerial) ? aerial : null;
  const garage = aerial?.garageLikely ? " A garage can't be counted from the air." : "";
  const n = counted?.stalls.n ?? 0, hi = counted?.stalls.hi ?? n;
  add(need ? `Room for ${need} car${need === 1 ? "" : "s"}` : "Parking on site", {
    costar: rec == null ? absent("No stall count on the CoStar record") : (need ? rec >= need : rec > 0) ? agree(`${rec} stalls on record`) : disagree(`${rec} stalls on record`),
    matterport: absent("Interior scan can't see parking"),
    aerial: !aerial ? absent(shell.lat != null ? "Aerial not counted for this space" : "No coordinates")
      : !counted ? absent("Two counts of the aerial disagreed, so it couldn't be counted")
      : n === 0 ? absent("No marked surface lot seen (faint markings can be missed)")
      : (need ? n >= need : n > 0) ? agree(`About ${n} stalls around the building`) : disagree(`About ${n}${hi > n ? `–${hi}` : ""} stalls around the building`),
  }, (counted && n === 0 ? "The aerial shows no marked surface lot; ask where patients or customers park."
    : counted && rec != null && (need ? (rec >= need) !== (n >= need) : (rec > 0) !== (n > 0))
    ? "The record and the aerial disagree; some stalls may be in a garage or a shared lot. Ask how many come with the space."
    : "Counts around the building include shared lots; ask how many stalls are assigned to this space.") + garage);

  // Rooftop units: only the aerial can count them; the record has no HVAC equipment field.
  const rtu = aerialRooftop(aerial);
  if (aerial) add("Rooftop AC units", {
    costar: absent("HVAC equipment isn't on the record"),
    matterport: absent("Interior scan can't see the roof"),
    aerial: rtu == null ? absent("Two counts of the aerial disagreed, so they couldn't be counted") : rtu > 0 ? agree(`${rtu} rooftop unit${rtu === 1 ? "" : "s"} counted`) : disagree("No rooftop units counted"),
  }, "Units on the roof say nothing about their capacity or age; ask the landlord.");

  if (spec.needs.kitchen || use === "restaurant") {
    const hood = graph?.objects.some((o) => /hood/.test(o.label)) || /hood|exhaust/i.test(desc);
    add("Kitchen-ready (sprinklers, hood, roof exhaust)", {
      costar: shell.sprinkler === "wet" ? agree("Wet sprinklers on record") : shell.sprinkler === "unknown" ? absent(recordNote) : disagree(`${shell.sprinkler} sprinklers`),
      matterport: hood ? agree("Hood seen or described") : graph ? disagree("No hood seen") : absent("No scan"),
      aerial: absent("Rooftop exhaust fans aren't counted on the aerial"),
    }, "Kitchen-ready needs all three: wet sprinklers, a hood, and an exhaust fan on the roof.");
  }
  return rows;
}
