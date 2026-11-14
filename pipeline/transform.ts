import { ringFromEdges, type Pt } from "../lib/geometry/polygon";
import { normalizeRoomLabel } from "../lib/reason/labels";
import type { City, Listing, Mode, Parcel, Room, RoomGraph, Shell } from "../lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Enums = Record<string, Record<string, string>>;

// CoStar fills unresearched contacts with "Research In Progress"; that is not a person to email.
export const isPlaceholderContact = (name?: string) => !name?.trim() || /research in progress/i.test(name);

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
      sweeps: (r.panoLocations ?? []).filter((p: Any) => p?.id).map((p: Any) => ({ id: p.id, index: Number(p.label) })).filter((p: { index: number }) => Number.isFinite(p.index)),
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
  const panos: NonNullable<RoomGraph["panos"]> = (m.panoLocations ?? []).filter((p: Any) => p.position).map((p: Any) => ({ id: p.id, label: p.label ?? "", x: p.position.x, y: p.position.y }));
  // Nearest sweep to each room's centroid, so the tour can open on the evidence.
  for (const r of rooms) {
    if (!r.polygon.length || !panos.length) continue;
    const c = r.polygon.reduce((s, p) => ({ x: s.x + p.x / r.polygon.length, y: s.y + p.y / r.polygon.length }), { x: 0, y: 0 });
    r.panoId = panos.reduce((best, p) => (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? p : best)).id;
  }
  return {
    sid: m.id,
    name: m.name ?? m.id,
    classification: m.propertyClassifications?.[0]?.classification,
    description: m.generatedDescription?.description ?? undefined,
    panos,
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

// A few CoStar records spell the city in lower case ("houston"); capitalise each word of the city.
export const tidyAddress = (addr: string) => addr.replace(/, ([a-z][a-z .'-]*), ([A-Z]{2})$/, (_, c: string, st) => `, ${c.replace(/\b[a-z]/g, (x) => x.toUpperCase())}, ${st}`);

function addressOf(a: Any): string {
  const street = [a?.streetNumber, a?.streetDirection, a?.streetName, a?.streetType].filter(Boolean).join(" ");
  return tidyAddress([street, a?.city, a?.state].filter(Boolean).join(", "));
}

function listingFor(listings: Any[], suiteName?: string): { listing?: Listing; space?: Any } {
  const active = listings.find((l) => l.listingStatus === 1) ?? listings[0];
  if (!active) return {};
  const suite = suiteName?.match(/(?:suite|ste\.?|#)\s*([\w-]+)/i)?.[1];
  const spaces: Any[] = listings.flatMap((l) => (l.forLeaseSummary?.spaces ?? []).map((s: Any) => ({ ...s, _l: l })));
  const space = suite ? spaces.find((s) => String(s.suite ?? "").toLowerCase() === suite.toLowerCase()) : undefined;
  const l = space?._l ?? active;
  const c = l.listingContacts?.find((x: Any) => !isPlaceholderContact([x.firstName, x.lastName].join(" ")));
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

const apnKey = (s: string) => String(s).replace(/[^0-9a-z]/gi, "").toLowerCase();
// Drops empty values; a Parcel with no facts is left off the shell.
const compact = (x: Parcel): Parcel | undefined => {
  const out = Object.fromEntries(Object.entries(x).filter(([k, v]) => k === "sources" || (v != null && v !== "" && !(Array.isArray(v) && !v.length)))) as Parcel;
  out.sources = Object.fromEntries(Object.entries(x.sources).filter(([k]) => k in out)) as Parcel["sources"];
  return Object.keys(out).length > 1 ? out : undefined;
};

// Lot/APN from the property record; last sale and the newest assessment/tax row for this property's own APNs from its sale comps.
export function parcelFromCommercial(p: Any, comps: Any[] = []): Parcel | undefined {
  const apns: string[] = (p.parcelNumbers ?? []).filter(Boolean);
  const unit = p.lotSizeMeasurementType; // MeasurementUnit: 1 = SquareFeet, 2 = Acres
  const x: Parcel = { sources: {} };
  if (apns.length) { x.apns = apns; x.sources.apns = "CommercialProperty.parcelNumbers"; }
  if (p.lotSize && unit === 2) { x.lotAcres = p.lotSize; x.sources.lotAcres = "CommercialProperty.lotSize (Acres)"; }
  if (p.lotSize && unit === 1) { x.lotSqft = p.lotSize; x.sources.lotSqft = "CommercialProperty.lotSize (SquareFeet)"; }
  if (p.land?.currentUsageDescription) { x.landUse = p.land.currentUsageDescription; x.sources.landUse = "CommercialProperty.land.currentUsageDescription"; }

  const sale = [...comps].filter((c) => c.soldDate).sort((a, b) => String(b.soldDate).localeCompare(String(a.soldDate)))[0];
  if (sale) {
    x.lastSaleDate = String(sale.soldDate).slice(0, 10);
    x.sources.lastSaleDate = `CommercialSaleComp ${sale.id}.soldDate`;
    const mine = (sale.entities ?? []).find((e: Any) => e.propertyId === p.id);
    // A portfolio sale's soldForPrice covers every property in it; only use it when this property is the whole sale.
    const price = mine?.allocatedPrice || ((sale.entities ?? []).length === 1 ? sale.soldForPrice : undefined);
    if (price > 0) { x.lastSalePrice = price; x.sources.lastSalePrice = `CommercialSaleComp ${sale.id}.${mine?.allocatedPrice ? "entities.allocatedPrice" : "soldForPrice"}`; }
  }
  const own = new Set(apns.map(apnKey));
  const rows = comps.flatMap((c) => (c.transferDocuments ?? []).flatMap((d: Any) => (d.assessments ?? []).map((a: Any) => ({ ...a, compId: c.id }))))
    .filter((a: Any) => own.has(apnKey(a.parcelNumber ?? "")));
  const assessed = rows.filter((a: Any) => a.assessment?.totalValue && a.assessmentYear).sort((a: Any, b: Any) => b.assessmentYear - a.assessmentYear)[0];
  if (assessed) {
    const at = `CommercialSaleComp ${assessed.compId}.transferDocuments.assessments (APN ${assessed.parcelNumber}, ${assessed.assessmentYear})`;
    x.assessedTotal = assessed.assessment.totalValue; x.sources.assessedTotal = `${at}.assessment.totalValue`;
    x.assessedLand = assessed.assessment.landValue ?? undefined; x.sources.assessedLand = `${at}.assessment.landValue`;
    x.assessedImproved = assessed.assessment.improvedValue ?? undefined; x.sources.assessedImproved = `${at}.assessment.improvedValue`;
    x.assessmentYear = assessed.assessmentYear; x.sources.assessmentYear = `${at}.assessmentYear`;
  }
  const tax = rows.filter((a: Any) => a.propertyTax && a.propertyTaxYear).sort((a: Any, b: Any) => b.propertyTaxYear - a.propertyTaxYear)[0];
  if (tax) {
    const at = `CommercialSaleComp ${tax.compId}.transferDocuments.assessments (APN ${tax.parcelNumber})`;
    x.taxAmount = tax.propertyTax; x.sources.taxAmount = `${at}.propertyTax`;
    x.taxYear = tax.propertyTaxYear; x.sources.taxYear = `${at}.propertyTaxYear`;
  }
  return compact(x);
}

export function parcelFromResidential(p: Any): Parcel | undefined {
  const acres = p.lotSizeAcresMax ?? p.lotSizeAcresMin;
  return compact({
    lotAcres: acres ?? undefined, taxAmount: p.taxes ?? undefined, subdivision: p.subdivision ?? undefined,
    sources: { lotAcres: `ResidentialListing.property.${p.lotSizeAcresMax != null ? "lotSizeAcresMax" : "lotSizeAcresMin"}`, taxAmount: "ResidentialListing.property.taxes (annual, as reported by the MLS)", subdivision: "ResidentialListing.property.subdivision" },
  });
}

export function shellFromCommercial(p: Any, scan: Any | undefined, listings: Any[], enums: Enums, comps: Any[] = []): Shell {
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
    parcel: parcelFromCommercial(p, comps),
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
    parcel: parcelFromResidential(p),
  };
}
