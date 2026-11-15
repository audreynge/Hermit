import table from "../../rules/screening.json";
import { normalizeZone } from "../regs/zones";
import type { Access, AccessRoom, AerialCount, Evidence, RequirementSpec, RoomGraph, RuleHit, RuleStatus, Shell } from "../types";
import { chairFor, checkAccess } from "./access";

export type UseKey = keyof typeof table.uses;
const src = (k: keyof typeof table.sources) => table.sources[k].url;

export function useCategory(useType: string): UseKey {
  const t = useType.toLowerCase();
  for (const [k, u] of Object.entries(table.uses)) if (u.match.some((m) => t.includes(m))) return k as UseKey;
  return "office";
}

export function laZoneClass(zoning: string): ("residential" | "commercial" | "industrial")[] {
  const z = zoning.toUpperCase().replace(/[\[(][A-Z]+[\])]/g, "").replace(/^LA(?=[A-Z])/, "");
  const letters = z.match(/^[A-Z]+/)?.[0] ?? "";
  if (letters.startsWith("CM")) return ["commercial", "industrial"];
  if (letters.startsWith("M")) return ["industrial", "commercial"];
  if (letters.startsWith("C")) return ["commercial"];
  if (letters.startsWith("R")) return ["residential"];
  return [];
}

const costar = (shell: Shell, field: string, confidence = 0.9): Evidence => ({
  source: "costar",
  ref: `${shell.propertyId ? `property ${shell.propertyId}` : shell.homesListingId ? `listing ${shell.homesListingId}` : shell.id}.${field}`,
  confidence,
});
const hit = (rule: string, status: RuleStatus, detail: string, citation: string, evidence: Evidence[] = []): RuleHit => ({
  rule, status, detail, citation, evidence,
});

const ESSENTIAL = new Set(["bedroom", "bathroom", "kitchen", "living", "office"]);
const TURN_IN = 60; // ADA §304.3.1 turning circle

// Door-by-door verdicts from the route check in ./access. Clear widths are scan estimates.
function wheelchairRoute(g: RoomGraph, a: Access, measured: boolean): RuleHit[] {
  const area = new Map(g.rooms.map((r) => [r.id, r.areaSqft]));
  const dup = (label: string) => a.asScanned.filter((r) => r.label === label).length > 1;
  // Two bathrooms both "blocked" reads as a typo; the floor area tells them apart.
  const name = (r: AccessRoom) => `${r.label[0].toUpperCase()}${r.label.slice(1)}${dup(r.label) ? ` (${Math.round(area.get(r.roomId) ?? 0)} sf)` : ""}`;
  const afterHinges = new Map(a.hinges.map((r) => [r.roomId, r]));
  const chair = measured ? `your ${a.chairIn[0]} in chair` : `a ${a.chairIn[0]} in chair (typical power chair; your width wasn't given)`;
  const ev = (r: AccessRoom): Evidence => ({ source: "matterport", ref: `${g.sid}/${r.roomId} (${r.label})`, confidence: 0.7 });
  const frontEv: Evidence = { source: "matterport", ref: `${g.sid}/${a.entry.roomId ?? "entry"} (outside door)`, confidence: 0.7 };
  const hits: RuleHit[] = [];

  // The front door comes first: if it stops the chair, every room behind it is out of reach for that one reason.
  if (a.entry.status === "blocked") {
    const reason = `Front door: the widest outside door is ~${a.entry.clearIn!.toFixed(1)} in clear, ${(a.chairIn[0] - a.entry.clearIn!).toFixed(1)} in short of ${chair}`;
    hits.push(a.hingesEntry.status === "fits"
      ? hit("door_hinges", "warn", `${reason}. Offset (swing-clear) hinges would let it in.`, src("ada"), [frontEv])
      : hit("front_door", "fail", `${reason}.`, src("ada"), [frontEv]));
    if (a.hingesEntry.status !== "fits") return hits;
  } else if (a.entry.status === "unknown") {
    hits.push(hit("front_door", "unknown", "Front door: the scan has no measured outside door.", src("ada"), [frontEv]));
  }

  const rooms = a.asScanned.filter((r) => ESSENTIAL.has(r.label));
  const upstairs = rooms.filter((r) => r.otherFloor);
  if (upstairs.length)
    hits.push(hit("other_floor", "fail", `${upstairs.map(name).join(", ")}: on another floor; the scan shows no elevator or stair lift.`, src("ada"), upstairs.map(ev)));

  for (const r of rooms.filter((x) => x.status === "blocked" && !x.otherFloor)) {
    const fixed = afterHinges.get(r.roomId);
    if (r.stopDoor?.from === "outside") {
      // Behind the front door: hinges on it got the chair in, so only an inside door that still stops it matters.
      if (fixed?.status === "blocked" && !fixed.otherFloor) hits.push(hit("door_width", "fail", `${name(r)}: ${fixed.reason}.`, src("ada"), [ev(r)]));
      continue;
    }
    hits.push(fixed?.status === "reachable"
      ? hit("door_hinges", "warn", `${name(r)}: ${r.reason}. Offset (swing-clear) hinges would let ${chair} in.`, src("ada"), [ev(r)])
      : hit("door_width", "fail", `${name(r)}: ${r.reason}.`, src("ada"), [ev(r)]));
  }
  const unknown = rooms.filter((x) => x.status === "unknown");
  if (unknown.length)
    hits.push(hit("door_width", "unknown", `No measured door into ${unknown.map(name).join(", ")}${unknown.some((r) => /open plan/.test(r.reason ?? "")) ? " (some look open plan; check in the 3D tour)" : ""}.`, src("ada"), unknown.map(ev)));
  if (rooms.length && rooms.every((x) => x.status === "reachable") && a.entry.status === "fits")
    hits.push(hit("wheelchair_route", "pass", `${chair[0].toUpperCase()}${chair.slice(1)} gets through the front door and reaches every main room (clear widths estimated from the scan).`, src("ada"), rooms.map(ev)));

  const baths = a.asScanned.filter((r) => r.turnCircleIn != null);
  if (baths.length) {
    const best = baths.reduce((x, y) => (y.turnCircleIn! > x.turnCircleIn! ? y : x));
    const d = best.turnCircleIn!;
    hits.push(d < TURN_IN
      ? hit("turning_space", "fail", `Largest clear circle in any bathroom is ${d} in, under the ${TURN_IN} in turning space, before fixtures are counted.`, src("ada"), [ev(best)])
      : hit("turning_space", "warn", `${name(best)} has a ${d} in clear circle between walls; fixtures are not measured and will reduce it.`, src("ada"), [ev(best)]));
  }
  return hits;
}

export type RuleExtras = { parcelZone?: { zone: string; source: string; apn: string } | null; aerial?: AerialCount | null };

// An aerial stall count is usable only when two runs agreed (confidence ≥ 0.5) and gave a number.
export const AERIAL_MIN_CONFIDENCE = 0.5;
export const aerialCounted = (a: AerialCount | null | undefined): a is AerialCount & { stalls: { n: number } } =>
  !!a && a.stalls.confidence >= AERIAL_MIN_CONFIDENCE && a.stalls.n != null;
export const aerialEvidence = (a: AerialCount): Evidence => ({
  source: aerialCounted(a) ? "Vexcel ortho (counted)" : "Vexcel ortho (not counted)", ref: `aerial:${a.sid}`, confidence: a.stalls.confidence,
});
export const aerialRooftop = (a: AerialCount | null | undefined): number | null =>
  a && a.rooftopUnits.confidence >= AERIAL_MIN_CONFIDENCE && a.rooftopUnits.n != null ? a.rooftopUnits.n : null;

/**
 * Parking from two layers: the CoStar record and stalls counted on the Vexcel aerial around the building.
 * Record or aerial meeting the need passes; both short (or one short and the other missing) fails, and only `hard`
 * (the user's own must-have) turns that into a fail; one short and the other enough is a disagreement to ask about.
 * Not counted, or counts that disagreed, is unknown, never a pass.
 */
export function parkingHit(rule: string, shell: Shell, aerial: AerialCount | null | undefined, need: number, hard: boolean, citation: string, needNote = "."): RuleHit {
  const rec = shell.parkingSpaces;
  const recEv = costar(shell, "parking.totalSpaces");
  const counted = aerialCounted(aerial) ? aerial : null;
  const ev = [recEv, ...(aerial ? [aerialEvidence(aerial)] : [])];
  const recOk = rec == null ? null : rec >= need;
  const n = counted?.stalls.n ?? 0, hi = counted?.stalls.hi ?? n;
  const aerOk: boolean | "close" | null = !counted ? null : n >= need ? true : hi < need ? false : "close";
  const garage = aerial?.garageLikely ? " A garage can't be counted from the air." : "";
  const sky = counted ? `room for about ${n} car${n === 1 ? "" : "s"} around the building on the Vexcel aerial` : "";
  const recText = rec == null ? "" : `${rec} recorded stall${rec === 1 ? "" : "s"} (CoStar)`;
  const notCounted = !aerial ? "the aerial wasn't counted for this space" : "two counts of the aerial disagreed, so it couldn't be counted";
  const want = `you need ${need}${needNote}`;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const short = hard ? "fail" : "warn";

  // A count of 0 means no marked surface lot was seen (faint markings get missed), not a lot that's too small:
  // it never fails a space on its own, it becomes a question.
  if (counted && n === 0) {
    const none = `the Vexcel aerial shows no marked surface lot around the building`;
    if (recOk === true) return hit(rule, "warn", `${cap(recText)}; ${want} But ${none}, so the stalls may be in a garage or a shared lot.${garage}`, citation, ev);
    if (recOk === false) return hit(rule, short, `${cap(recText)}; ${want} And ${none}.${garage}`, citation, ev);
    return hit(rule, "unknown", `No stall count on the CoStar record, and ${none} (faint markings can be missed); ${want}${garage}`, citation, ev);
  }
  if (recOk === true && aerOk !== false)
    return hit(rule, "pass", `${cap(recText)}; ${want}${counted ? ` The Vexcel aerial shows room for about ${n} around the building.` : ""}${garage}`, citation, ev);
  if (recOk === true && aerOk === false)
    return hit(rule, "warn", `The records disagree: ${recText}, but ${sky}; ${want} Some stalls may be in a garage or a shared lot.${garage}`, citation, ev);
  if (recOk === false && aerOk === true)
    return hit(rule, "warn", `The records disagree: ${recText}, but ${sky}; ${want}${garage}`, citation, ev);
  if (recOk === null && aerOk === true)
    return hit(rule, "pass", `${cap(sky)}; ${want} No stall count on the CoStar record.${garage}`, citation, ev);
  if (aerOk === false)
    return hit(rule, short, `${cap(sky)}; ${want}${rec != null ? ` The CoStar record lists ${rec}.` : ""}${garage}`, citation, ev);
  if (aerOk === "close")
    return recOk === false
      ? hit(rule, short, `${cap(recText)}; ${want} The aerial shows about ${n}–${hi} around the building, which doesn't settle it.${garage}`, citation, ev)
      : hit(rule, "warn", `About ${n}–${hi} cars fit around the building on the Vexcel aerial; ${want} Too close to call.${garage}`, citation, ev);
  if (recOk === false)
    return hit(rule, short, `${cap(recText)}; ${want} ${cap(notCounted)}.${garage}`, citation, ev);
  return hit(rule, "unknown", `No stall count on the CoStar record, and ${notCounted}; ${want}${garage}`, citation, ev);
}

export const NO_LOT_QUESTION = "Where do patients or customers park? The aerial shows no marked surface lot around the building.";
/** The landlord question for a parking screen that isn't a pass. */
export function parkingQuestion(h: RuleHit, fallback: string): string {
  if (/no marked surface lot/.test(h.detail)) return NO_LOT_QUESTION;
  return h.status === "warn" ? `${h.detail} How many stalls come with the space, and where are they?` : fallback;
}

/** The stall count Hermit screens against: the user's number when they gave one, else the use's code-minimum estimate. */
export function parkingNeed(spec: RequirementSpec, shell: Shell, graph?: RoomGraph | null): number | null {
  if (spec.needs.parkingStalls) return spec.needs.parkingStalls;
  const per1000 = table.uses[useCategory(spec.useType)].parkingPer1000[spec.city];
  const area = graph?.totalAreaSqft ?? shell.sqft ?? spec.sizeSqft?.[0];
  if (per1000 > 0 && area) return Math.ceil((per1000 * area) / 1000);
  return spec.needs.parking ? 1 : null;
}

export function checkRules(spec: RequirementSpec, shell: Shell, graph?: RoomGraph, extras: RuleExtras = {}): RuleHit[] {
  const hits: RuleHit[] = [];
  const use = useCategory(spec.useType);
  const u = table.uses[use];
  const area = graph?.totalAreaSqft ?? shell.sqft ?? spec.sizeSqft?.[0];
  const n = spec.needs;

  if (n.heavyPower || n.threePhase) {
    const ev = [costar(shell, "electric.hasHeavyPower")];
    if (shell.heavyPower === true) hits.push(hit("electrical", "pass", "Record lists heavy power. Amperage/phase still to confirm with landlord.", src("nfpa70"), ev));
    else if (shell.heavyPower === false) hits.push(hit("electrical", "fail", "Record shows no heavy power; service upgrade likely needed.", src("nfpa70"), ev));
    else hits.push(hit("electrical", "unknown", "Power service is not in the record (null).", src("nfpa70"), ev));
  }

  if (n.esfr) {
    const ev = [costar(shell, "sprinklerType")];
    if (shell.sprinkler === "esfr") hits.push(hit("fire", "pass", "Record lists ESFR sprinklers.", src("nfpa13"), ev));
    else if (shell.sprinkler === "unknown") hits.push(hit("fire", "unknown", "Sprinkler type not recorded.", src("nfpa13"), ev));
    else hits.push(hit("fire", "fail", `Record lists ${shell.sprinkler} sprinklers, not ESFR; high-piled storage would need a retrofit.`, src("nfpa13"), ev));
  }

  if (n.driveInBays) {
    const ev = [costar(shell, "driveInBays.numDriveInBays")];
    if (shell.driveInBays == null) hits.push(hit("drive_in_bays", "unknown", "Drive-in bay count not recorded.", src("costar_kit"), ev));
    else hits.push(hit("drive_in_bays", shell.driveInBays >= n.driveInBays ? "pass" : "fail", `${shell.driveInBays} drive-in bay(s) recorded; ${n.driveInBays} needed.`, src("costar_kit"), ev));
  }

  // Living in a home is the use it was built for; zoning and deed-restriction screens are for businesses.
  if (use === "home") {
    // no zoning screen
  } else if (spec.city === "houston") {
    hits.push(hit("zoning", "unknown", "Houston has no use zoning; check deed restrictions and the plat for this lot.", src("houston_zoning")));
  } else if (!shell.zoning) {
    hits.push(hit("zoning", "unknown", "Zoning code not in the record.", src("lamc_zoning"), [costar(shell, "zoningDescription")]));
  } else {
    const classes = laZoneClass(shell.zoning);
    const ev = [costar(shell, "zoningDescription")];
    const want = u.zone as "residential" | "commercial" | "industrial";
    if (!classes.length) hits.push(hit("zoning", "unknown", `Could not classify zone "${shell.zoning}".`, src("lamc_zoning"), ev));
    else if (classes.includes(want)) hits.push(hit("zoning", "pass", `Zone ${shell.zoning} generally permits ${want} uses (screening; overlays and conditions not checked).`, src("lamc_zoning"), ev));
    else hits.push(hit("zoning", "fail", `Zone ${shell.zoning} is ${classes.join("/")}; ${use} use likely needs a variance or conditional use.`, src("lamc_zoning"), ev));
  }

  if (extras.parcelZone) {
    const pz = extras.parcelZone;
    const ev = [costar(shell, "zoningDescription"), { source: "scag", ref: pz.source, confidence: 0.6 }];
    const agree = shell.zoning && normalizeZone(shell.zoning) === normalizeZone(pz.zone);
    hits.push(shell.zoning
      ? hit("zoning_records", agree ? "pass" : "warn", agree ? `Parcel zoning layer confirms zone ${pz.zone}.` : `Zoning records disagree: CoStar says ${shell.zoning}, the regional parcel layer says ${pz.zone}. Confirm with the city.`, src("lamc_zoning"), ev)
      : hit("zoning_records", "warn", `Parcel zoning layer says ${pz.zone}; CoStar has no zoning on record.`, src("lamc_zoning"), ev));
  }

  const per1000 = u.parkingPer1000[spec.city];
  if (per1000 > 0 && area) {
    const need = Math.ceil((per1000 * area) / 1000);
    const required = Math.max(need, n.parkingStalls ?? 0);
    const cite = spec.city === "houston" ? src("houston_parking") : src("lamc_parking");
    const laNote = spec.city === "los_angeles" ? " AB 2097 may waive minimums near major transit." : "";
    // The code-minimum screen is our estimate, so it can warn but never rules a space out.
    hits.push(parkingHit("parking", shell, extras.aerial, required, false, cite, ` (screening estimate, ${per1000}/1,000 sf).${laNote}`));
  }

  if (n.parking || n.parkingStalls) {
    hits.push(parkingHit("onsite_parking", shell, extras.aerial, Math.max(1, n.parkingStalls ?? 0), true, src("costar_kit")));
  }

  if (n.groundFloor) {
    const ev = [costar(shell, "numStoriesAboveGrade")];
    if (shell.stories === 1) hits.push(hit("ground_floor", "pass", "Single-story building, so the space is at grade.", src("costar_kit"), ev));
    else hits.push(hit("ground_floor", "unknown", shell.stories ? `${shell.stories}-story building; which floor this space is on isn't recorded.` : "Floor level isn't recorded.", src("costar_kit"), ev));
  }

  if (n.transit) {
    hits.push(hit("transit", "unknown", "Transit access not checked yet: the bundle has no transit stop data for this site.", src("costar_kit")));
  }

  if (n.stepFree || n.wheelchair) {
    const ev = [costar(shell, "numStoriesAboveGrade"), costar(shell, "structural.elevators")];
    if (shell.stories != null && shell.stories > 1 && shell.elevator === false)
      hits.push(hit("accessibility", "fail", `${shell.stories}-story building with no elevator recorded; upper floors lack an accessible route.`, src("ada"), ev));
    else if (shell.elevator === true || shell.stories === 1)
      hits.push(hit("accessibility", "warn", "Vertical access looks available; entry thresholds, door widths (32\" clear) and restroom turning space not verified.", src("ada"), ev));
    else hits.push(hit("accessibility", "unknown", "Floor level and elevator access not recorded.", src("ada"), ev));
  }
  const access = n.wheelchair && graph ? checkAccess(graph, chairFor(n)) : null;
  if (access) hits.push(...wheelchairRoute(graph!, access, n.chairWidthIn != null));
  else if (n.wheelchair && graph) hits.push(hit("door_width", "unknown", "The scan has no measured door widths, so the wheelchair route can't be checked.", src("ada"), [{ source: "matterport", ref: graph.sid, confidence: 0.5 }]));

  if (area && use !== "home") {
    const [lo, hi] = u.sfPerTon;
    hits.push(hit("hvac", "unknown", `Estimated cooling load ${Math.round(area / hi)}–${Math.round(area / lo)} tons for ${use}; installed capacity is not in the record.`, src("ashrae_rule")));
  }

  if (use !== "home" || shell.listing) {
    const l = shell.listing;
    const ev: Evidence[] = l ? [{ source: "costar", ref: `listing ${l.listingId}.listingStatus`, confidence: 0.8 }] : [];
    if (l?.status === "active") hits.push(hit("availability", "pass", "Active listing on record (not a live availability guarantee).", src("costar_kit"), ev));
    else if (l) hits.push(hit("availability", "warn", `Listing status is ${l.status}; confirm availability.`, src("costar_kit"), ev));
    else hits.push(hit("availability", "unknown", "No listing linked to this scan; availability unknown.", src("costar_kit"), ev));
  }

  if (spec.beds != null && shell.beds != null)
    hits.push(hit("bedrooms", shell.beds >= spec.beds ? "pass" : "fail", `${shell.beds} bedrooms listed; ${spec.beds} needed.`, src("costar_kit"), [costar(shell, "property.bedsMax")]));
  if (spec.baths != null && shell.baths != null)
    hits.push(hit("bathrooms", shell.baths >= spec.baths ? "pass" : "fail", `${shell.baths} baths listed; ${spec.baths} needed.`, src("costar_kit"), [costar(shell, "property.bathsMax")]));

  if (spec.mode === "home" && graph && shell.sqft) {
    const gap = (shell.sqft - graph.totalAreaSqft) / shell.sqft;
    const pct = Math.round(Math.abs(gap) * 100);
    const ev = [costar(shell, "property.sqftMax"), { source: "matterport", ref: `${graph.sid}.dimensions.areaFloor`, confidence: 0.8 }];
    hits.push(hit("measured_size", pct > 10 ? "warn" : "pass",
      `Listing says ${shell.sqft} sf; scan measures ${Math.round(graph.totalAreaSqft)} sf net floor (${pct}% ${gap > 0 ? "smaller" : "larger"}). Net vs gross differences are normal; a screening flag, not a misstatement.`,
      src("costar_kit"), ev));
  }

  return hits;
}
