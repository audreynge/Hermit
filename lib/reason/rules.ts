import table from "../../rules/screening.json";
import { normalizeZone } from "../regs/zones";
import type { Evidence, RequirementSpec, RoomGraph, RuleHit, RuleStatus, Shell } from "../types";

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

  if (n.parking) {
    const ev = [costar(shell, "parking.totalSpaces")];
    if (shell.parkingSpaces == null) hits.push(hit("onsite_parking", "unknown", "On-site parking count is not recorded.", src("costar_kit"), ev));
    else hits.push(hit("onsite_parking", shell.parkingSpaces > 0 ? "pass" : "fail", `${shell.parkingSpaces} on-site stalls recorded.`, src("costar_kit"), ev));
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

  if (area && use !== "home") {
    const [lo, hi] = u.sfPerTon;
    hits.push(hit("hvac", "unknown", `Estimated cooling load ${Math.round(area / hi)}–${Math.round(area / lo)} tons for ${use}; installed capacity is not in the record.`, src("ashrae_rule")));
  }

  if (use !== "home" || shell.listing) {
    const l = shell.listing;
    const ev: Evidence[] = l ? [{ source: "costar", ref: `listing ${l.listingId}.listingStatus`, confidence: 0.8 }] : [];
    if (l?.status === "active") hits.push(hit("availability", "pass", "Active listing on record (not a live availability guarantee).", src("costar_kit"), ev));
    else hits.push(hit("availability", "warn", l ? `Listing status is ${l.status}; confirm availability.` : "No active listing on record; availability unknown.", src("costar_kit"), ev));
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
