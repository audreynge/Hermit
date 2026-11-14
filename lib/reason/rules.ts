import table from "../../rules/screening.json";
import { normalizeZone } from "../regs/zones";
import type { Access, AccessRoom, Evidence, RequirementSpec, RoomGraph, RuleHit, RuleStatus, Shell } from "../types";
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

export type RuleExtras = { parcelZone?: { zone: string; source: string; apn: string } | null };

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

  if (spec.city === "houston") {
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
    const ev = [costar(shell, "parking.totalSpaces")];
    const laNote = spec.city === "los_angeles" ? " AB 2097 may waive minimums near major transit." : "";
    if (shell.parkingSpaces == null) hits.push(hit("parking", "unknown", `Screening need ~${required} stalls (${per1000}/1,000 sf); recorded count unknown.${laNote}`, cite, ev));
    else hits.push(hit("parking", shell.parkingSpaces >= required ? "pass" : "warn", `${shell.parkingSpaces} recorded stalls vs ~${required} screening need (${per1000}/1,000 sf).${laNote}`, cite, ev));
  }

  if (n.parking || n.parkingStalls) {
    const ev = [costar(shell, "parking.totalSpaces")];
    const want = Math.max(1, n.parkingStalls ?? 0);
    if (shell.parkingSpaces == null) hits.push(hit("onsite_parking", "unknown", "On-site parking count is not recorded.", src("costar_kit"), ev));
    else hits.push(hit("onsite_parking", shell.parkingSpaces >= want ? "pass" : "fail", `${shell.parkingSpaces} on-site stalls recorded${n.parkingStalls ? `; ${n.parkingStalls} needed` : ""}.`, src("costar_kit"), ev));
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
