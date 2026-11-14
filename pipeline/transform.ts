import { ringFromEdges, type Pt } from "../lib/geometry/polygon";
import { normalizeRoomLabel } from "../lib/reason/labels";
import type { City, Listing, Mode, Room, RoomGraph, Shell } from "../lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Enums = Record<string, Record<string, string>>;

export function roomGraphFromModel(m: Any): RoomGraph {
  const edgeOwners = new Map<string, { rooms: string[]; door: boolean }>();
  const rooms: Room[] = [];
  for (const r of m.rooms ?? []) {
    const metric = r.dimensions?.units === "metric";
    const area = (r.dimensions?.areaFloor ?? 0) * (metric ? 10.7639 : 1);
    if (area <= 0) continue;
    const edges = r.boundary?.edges ?? [];
    for (const e of edges) {
      const o = edgeOwners.get(e.id) ?? { rooms: [], door: false };
      o.rooms.push(r.id);
      o.door ||= (e.openings ?? []).some((x: Any) => /door|opening/i.test(x.type));
      edgeOwners.set(e.id, o);
    }
    const segs: Pt[][] = edges.map((e: Any) => (e.vertices ?? []).map((v: Any) => v.position));
    rooms.push({
      id: r.id,
      label: normalizeRoomLabel([r.label, ...(r.tags ?? []), ...(r.classifications ?? []).map((c: Any) => c.label)]),
      rawTags: [r.label, ...(r.tags ?? [])].filter(Boolean),
      areaSqft: area,
      heightFt: r.dimensions?.height ? r.dimensions.height * (metric ? 3.28084 : 1) : undefined,
      polygon: ringFromEdges(segs),
      floorId: r.floor?.id ?? "",
    });
  }
  const keep = new Set(rooms.map((r) => r.id));
  const links: RoomGraph["edges"] = [];
  for (const { rooms: owners, door } of edgeOwners.values()) {
    const [a, b] = owners;
    if (!b || a === b || !keep.has(a) || !keep.has(b)) continue;
    const key = [a, b].sort().join("|");
    const existing = links.find((l) => [l.a, l.b].sort().join("|") === key);
    if (existing) { if (door) existing.kind = "door"; continue; }
    links.push({ a, b, kind: door ? "door" : "possible" });
  }
  return {
    sid: m.id,
    name: m.name ?? m.id,
    classification: m.propertyClassifications?.[0]?.classification,
    totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0),
    rooms,
    edges: links,
    objects: (m.objectAnnotations ?? []).map((o: Any) => ({ label: String(o.label).toLowerCase(), roomId: o.room?.id ?? null, confidence: o.confidence ?? 0 })),
    panoCount: m.panoLocations?.length ?? 0,
    floorCount: m.floors?.length ?? 1,
  };
}

export function parseSuiteSqft(name: string): number | undefined {
  const m = name.match(/([\d,]{3,})\s*(?:SF|sq\.?\s*ft)/i);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

const cityOf = (state?: string): City | null => (state === "TX" ? "houston" : state === "CA" ? "los_angeles" : null);
const SPRINKLER: Record<string, Shell["sprinkler"]> = { "1": "wet", "2": "dry", "3": "esfr" };
const USE_TAGS: [RegExp, string][] = [
  [/medical|dental|clinic|health/i, "medical"], [/salon|\bspa\b|barber/i, "salon"], [/retail|storefront|shop/i, "retail"],
  [/restaurant|cafe|kitchen/i, "restaurant"], [/warehouse|distribution/i, "warehouse"], [/manufactur|r ?and ?d|lab/i, "manufacturing"],
  [/office|loft|creative|suite/i, "office"], [/showroom/i, "showroom"], [/fitness|gym/i, "fitness"], [/school|day ?care/i, "education"],
];
const LISTING_STATUS: Record<number, Listing["status"]> = { 1: "active", 2: "contract", 4: "sold" };

function addressOf(a: Any): string {
  const street = [a?.streetNumber, a?.streetDirection, a?.streetName, a?.streetType].filter(Boolean).join(" ");
  return [street, a?.city, a?.state].filter(Boolean).join(", ");
}

function listingFor(listings: Any[], suiteName?: string): { listing?: Listing; space?: Any } {
  const active = listings.find((l) => l.listingStatus === 1) ?? listings[0];
  if (!active) return {};
  const suite = suiteName?.match(/(?:suite|ste\.?|#)\s*([\w-]+)/i)?.[1];
  const spaces: Any[] = listings.flatMap((l) => (l.forLeaseSummary?.spaces ?? []).map((s: Any) => ({ ...s, _l: l })));
  const space = suite ? spaces.find((s) => String(s.suite ?? "").toLowerCase() === suite.toLowerCase()) : undefined;
  const l = space?._l ?? active;
  const c = l.listingContacts?.[0];
  return {
    space,
    listing: {
      listingId: l.id,
      status: l.listingStatus === 1 ? "active" : "off_market",
      askingRate: space?.askingRateHasValue ? space.rateLow || space.rateHigh : undefined,
      availableSqft: space?.squareFeetMax ?? l.forLeaseSummary?.totalAvailableSquareFeet ?? undefined,
      contact: c ? { name: [c.firstName, c.lastName].filter(Boolean).join(" "), company: c.locationName, email: c.emailAddress } : undefined,
    },
  };
}

export function shellFromCommercial(p: Any, scan: Any | undefined, listings: Any[], enums: Enums): Shell {
  const type = enums.PropertyType?.[p.propertyType] ?? String(p.propertyType);
  const subtype = enums.PropertySubtype?.[p.propertySubtype] ?? "Unknown";
  const mode: Mode = type === "Industrial" || type === "Flex" ? "enterprise" : "business";
  const typed = p.propertyIndustrial ?? p.propertyFlex ?? p.propertyOffice ?? p.propertyRetail ?? {};
  const structural = typed.structural ?? {};
  const elevators: Any[] = structural.elevators ?? [];
  const elevator = elevators.some((e) => e.elevatorType === 1 && e.elevatorState === 1) ? true
    : elevators.some((e) => e.elevatorType === 1 && e.elevatorState === 2) ? false : null;
  const counted = (p.parking ?? []).filter((x: Any) => x.totalSpaces != null);
  const { listing, space } = listingFor(listings, scan?.name);
  const nameSqft = scan ? parseSuiteSqft(scan.name) : undefined;
  const typedArea = typed.rentableBuildingAreaSquareFeet ?? typed.grossLeasableAreaSquareFeet;
  const sqft = space?.squareFeetMax ?? nameSqft ?? (scan && mode === "business" ? undefined : typedArea ?? p.rentableBuildingAreaSquareFeet ?? p.grossBuildingAreaSquareFeet);
  const tagText = `${subtype} ${type} ${scan?.name ?? ""}`;
  const city = cityOf(p.primaryAddress?.state) ?? "los_angeles";

  return {
    id: scan?.sid ?? `prop-${p.id}`,
    sid: scan?.sid,
    mode,
    city,
    name: scan?.name ? `${scan.name} · ${p.buildingName ?? addressOf(p.primaryAddress)}` : p.buildingName ?? addressOf(p.primaryAddress),
    address: addressOf(p.primaryAddress),
    lat: p.primaryAddress?.latitude,
    lon: p.primaryAddress?.longitude,
    propertyId: p.id,
    propertyType: type,
    subtype,
    useTags: [...new Set(USE_TAGS.filter(([re]) => re.test(tagText)).map(([, t]) => t))],
    sqft,
    sqftSource: space ? "listing space" : nameSqft ? "scan name" : sqft ? "building record" : undefined,
    buildingSqft: p.grossBuildingAreaSquareFeet ?? undefined,
    buildingClass: enums.BuildingClass?.[p.buildingClass],
    yearBuilt: (p.constructionEvents ?? []).find((e: Any) => e.eventType === 2)?.year,
    stories: p.numStoriesAboveGrade ?? undefined,
    constructionStatus: enums.ConstructionStatus?.[p.constructionStatus],
    sprinkler: SPRINKLER[p.sprinklerType] ?? "unknown",
    heavyPower: typed.electric?.hasHeavyPower ?? null,
    amps: typed.electric?.ampsHigh ?? typed.electric?.ampsLow ?? undefined,
    volts: typed.electric?.voltsHigh ?? typed.electric?.voltsLow ?? undefined,
    driveInBays: typed.driveInBays?.numDriveInBays ?? null,
    loadingDocks: typed.numExternalLoadingDocks ?? null,
    ceilingFt: structural.ceilingHeightFeet ?? undefined,
    parkingSpaces: counted.length ? counted.reduce((s: number, x: Any) => s + x.totalSpaces, 0) : null,
    parkingRatio: p.parkingRatio ?? undefined,
    zoning: p.zoningDescription ?? null,
    elevator,
    listing,
    roomCount: scan?.room_count ? Number(scan.room_count) : undefined,
    panoCount: scan?.pano_count ? Number(scan.pano_count) : undefined,
  };
}

export function shellFromResidential(r: Any): Shell {
  const p = r.property ?? {};
  const a = p.address ?? {};
  const sid = (r.media ?? []).find((m: Any) => m.videoKey && [36, 234].includes(m.threeDimensionalScanType ?? m.externalReferenceType))?.videoKey;
  return {
    id: sid ?? `home-${r.id}`,
    sid,
    mode: "home",
    city: cityOf(a.state) ?? "los_angeles",
    name: a.fullStreetAddress ?? "Home",
    address: [a.fullStreetAddress, a.city, a.state].filter(Boolean).join(", "),
    lat: a.latitude,
    lon: a.longitude,
    homesListingId: r.id,
    propertyType: "Residential",
    subtype: p.mlsPropertyType ?? "Residential",
    useTags: ["home"],
    sqft: p.sqftMax ?? p.sqftMin ?? undefined,
    sqftSource: p.sqftMax || p.sqftMin ? "listing" : undefined,
    yearBuilt: p.yearBuilt ?? undefined,
    sprinkler: "unknown",
    heavyPower: null,
    driveInBays: null,
    loadingDocks: null,
    parkingSpaces: p.totalParkingSpaces ?? null,
    zoning: null,
    elevator: null,
    beds: p.bedsMax ?? p.bedsMin ?? undefined,
    baths: p.bathsMax ?? p.bathsMin ?? undefined,
    listing: {
      listingId: r.id,
      status: LISTING_STATUS[r.listingStatus] ?? "other",
      price: r.currentPrice ?? undefined,
      url: p.url ? `https://www.homes.com/property/${p.url}` : undefined,
    },
  };
}
