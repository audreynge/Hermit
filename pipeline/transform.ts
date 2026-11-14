import { ringFromEdges, type Pt } from "../lib/geometry/polygon";
import { normalizeRoomLabel } from "../lib/reason/labels";
import type { City, Listing, Mode, Room, RoomGraph, Shell } from "../lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Enums = Record<string, Record<string, string>>;

export function roomGraphFromModel(m: Any): RoomGraph {
  const edgeOwners = new Map<string, { rooms: string[]; door: boolean; widthIn?: number; at?: Pt }>();
  const rooms: Room[] = [];
  for (const r of m.rooms ?? []) {
    const metric = r.dimensions?.units === "metric";
    const area = (r.dimensions?.areaFloor ?? 0) * (metric ? 10.7639 : 1);
    if (area <= 0) continue;
    const edges = r.boundary?.edges ?? [];
    for (const e of edges) {
      const o = edgeOwners.get(e.id) ?? { rooms: [], door: false };
      const doors = (e.openings ?? []).filter((x: Any) => /door|opening/i.test(x.type));
      o.rooms.push(r.id);
      o.door ||= doors.length > 0;
      // Opening widths are metres; slivers under 18 in are scan noise, not doors.
      const [v0, v1] = (e.vertices ?? []).map((v: Any) => v.position as Pt);
      for (const d of doors) {
        const w = (d.width ?? 0) / 0.0254;
        if (w < 18 || w <= (o.widthIn ?? 0)) continue;
        o.widthIn = w;
        // Door centre along its wall; the wall's midpoint when the scan gives no position.
        const t = typeof d.relativeCenter === "number" ? d.relativeCenter : 0.5;
        if (v0 && v1) o.at = { x: v0.x + (v1.x - v0.x) * t, y: v0.y + (v1.y - v0.y) * t };
      }
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
      sweeps: (r.panoLocations ?? []).filter((p: Any) => p?.id).map((p: Any) => ({ id: p.id, index: Number(p.label) })).filter((p: { index: number }) => Number.isFinite(p.index)),
    });
  }
  const keep = new Set(rooms.map((r) => r.id));
  const links: RoomGraph["edges"] = [];
  const entry = new Set<string>();
  for (const { rooms: owners, door, widthIn, at } of edgeOwners.values()) {
    const [a, b] = owners;
    if (!b && door && keep.has(a)) entry.add(a);
    if (!b || a === b || !keep.has(a) || !keep.has(b)) continue;
    const key = [a, b].sort().join("|");
    const existing = links.find((l) => [l.a, l.b].sort().join("|") === key);
    if (existing) {
      if (door) existing.kind = "door";
      if (widthIn && widthIn > (existing.widthIn ?? 0)) Object.assign(existing, { widthIn, ...(at ? { at } : {}) });
      continue;
    }
    links.push({ a, b, kind: door ? "door" : "possible", ...(widthIn ? { widthIn } : {}), ...(at ? { at } : {}) });
  }
  return {
    sid: m.id,
    name: m.name ?? m.id,
    classification: m.propertyClassifications?.[0]?.classification,
    totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0),
    rooms,
    edges: links,
    entryRoomIds: [...entry],
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
      kind: l.forSaleSummary || l.auctionForSaleSummary ? "sale" : "lease",
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
      kind: r.transactionType === 2 ? "lease" : "sale",
      price: r.currentPrice ?? undefined,
      url: p.url ? `https://www.homes.com/property/${p.url}` : undefined,
    },
  };
}
