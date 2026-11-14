import { describe, expect, it } from "vitest";
import { parseSuiteSqft, roomGraphFromModel, shellFromCommercial, shellFromResidential } from "./transform";

const wall = (id: string, a: [number, number], b: [number, number], openings: string[] = []) => ({
  id, type: "wall", openings: openings.map((type) => ({ type })),
  vertices: [{ position: { x: a[0], y: a[1] } }, { position: { x: b[0], y: b[1] } }],
});

const model = {
  id: "SID1",
  name: "Suite 750",
  propertyClassifications: [{ classification: "workspace", type: "vision" }],
  floors: [{ id: "f1" }],
  panoLocations: [{ id: "p1" }, { id: "p2" }],
  rooms: [
    { id: "void", tags: [], classifications: [{ label: "Void" }], dimensions: { areaFloor: 0, units: "imperial" }, floor: { id: "f1" }, boundary: { edges: [] } },
    {
      id: "a", label: null, tags: ["other", "unfurnished"], dimensions: { areaFloor: 129.2, height: 2.7, units: "imperial" }, floor: { id: "f1" },
      boundary: { edges: [wall("e1", [0, 0], [4, 0]), wall("shared", [4, 0], [4, 3], ["doorway"]), wall("e3", [4, 3], [0, 3]), wall("e4", [0, 3], [0, 0])] },
    },
    {
      id: "b", label: "Restroom", tags: [], dimensions: { areaFloor: 40, units: "imperial" }, floor: { id: "f1" },
      panoLocations: [{ id: "pB1", label: "12" }, { id: "pB2", label: "13" }],
      boundary: { edges: [wall("shared", [4, 0], [4, 3], ["doorway"]), wall("e5", [4, 3], [6, 3]), wall("e6", [6, 3], [6, 0]), wall("e7", [6, 0], [4, 0])] },
    },
  ],
  objectAnnotations: [{ label: "Sink", confidence: 0.8, room: { id: "b" } }, { label: "Chair", confidence: 0.4, room: null }],
};

describe("roomGraphFromModel", () => {
  const g = roomGraphFromModel(model);

  it("drops zero-area voids and normalizes labels", () => {
    expect(g.rooms.map((r) => [r.id, r.label])).toEqual([["a", "other"], ["b", "bathroom"]]);
  });

  it("builds polygons from wall edges and keeps Matterport's area", () => {
    expect(g.rooms[0].polygon).toHaveLength(4);
    expect(g.rooms[0].areaSqft).toBeCloseTo(129.2);
    expect(g.totalAreaSqft).toBeCloseTo(169.2);
  });

  it("links rooms that share an edge, as a door when the edge has a doorway", () => {
    expect(g.edges).toEqual([{ a: "a", b: "b", kind: "door" }]);
  });

  it("keeps object annotations with their room and counts panos and floors", () => {
    expect(g.objects).toEqual([{ label: "sink", roomId: "b", confidence: 0.8 }, { label: "chair", roomId: null, confidence: 0.4 }]);
    expect(g.panoCount).toBe(2);
    expect(g.floorCount).toBe(1);
    expect(g.classification).toBe("workspace");
  });
});

describe("sweeps", () => {
  it("keeps sweep ids and numbers per room", () => {
    const g = roomGraphFromModel(model);
    expect(g.rooms.find((r) => r.id === "b")?.sweeps).toEqual([{ id: "pB1", index: 12 }, { id: "pB2", index: 13 }]);
    expect(g.rooms.find((r) => r.id === "a")?.sweeps).toEqual([]);
  });
});

describe("units", () => {
  it("keeps imperial values as feet and converts metric ones", () => {
    const room = (units: string) => ({ id: "r", tags: ["office"], dimensions: { areaFloor: 10, height: 3, units }, floor: { id: "f" }, boundary: { edges: [] } });
    const imp = roomGraphFromModel({ id: "M", rooms: [room("imperial")] }).rooms[0];
    expect(imp).toMatchObject({ areaSqft: 10, heightFt: 3 });
    const met = roomGraphFromModel({ id: "M", rooms: [room("metric")] }).rooms[0];
    expect(met.areaSqft).toBeCloseTo(107.64, 1);
    expect(met.heightFt).toBeCloseTo(9.84, 1);
  });
});

describe("parseSuiteSqft", () => {
  it("reads square footage from scan names", () => {
    expect(parseSuiteSqft("Brentwood Medical Plaza - Suite 106 - 9,170 SF")).toBe(9170);
    expect(parseSuiteSqft("Office/Retail - 45,726SF")).toBe(45726);
    expect(parseSuiteSqft("Suite 750")).toBeUndefined();
  });
});

const property = {
  id: 83684, propertyType: 5, propertySubtype: 501, buildingClass: 1, constructionStatus: 1,
  buildingName: "Wilshire West Medical Tower", numStoriesAboveGrade: 11,
  grossBuildingAreaSquareFeet: 76760, sprinklerType: 3, zoningDescription: "LAC4",
  parking: [{ parkingType: 1, totalSpaces: 15 }, { parkingType: 3, totalSpaces: 5 }, { parkingType: 8 }],
  primaryAddress: { streetNumber: "11645", streetName: "Wilshire", streetType: "Blvd", city: "Los Angeles", state: "CA", latitude: 34.05, longitude: -118.46 },
  propertyOffice: { rentableBuildingAreaSquareFeet: 76000, structural: { elevators: [{ elevatorType: 1, numElevators: 4, elevatorState: 1 }] } },
  constructionEvents: [{ eventType: 2, year: 1978 }],
};
const enums = {
  PropertyType: { "5": "Office" }, PropertySubtype: { "501": "Office_Medical" },
  BuildingClass: { "1": "A" }, ConstructionStatus: { "1": "Existing" },
};

describe("shellFromCommercial", () => {
  const listing = {
    id: 3926912, listingStatus: 1, listingContacts: [{ firstName: "Cody", lastName: "Powers", locationName: "Boulevard Medical", emailAddress: "c@example.com" }],
    forLeaseSummary: { spaces: [{ suite: "106", squareFeetMax: 9170, rateLow: 42, rateHigh: 48, askingRateHasValue: true }] },
  };
  const s = shellFromCommercial(property, { sid: "S1", name: "Suite 106", room_count: "4", pano_count: "20" }, [listing], enums);

  it("maps CoStar fields with enums and sums parking", () => {
    expect(s).toMatchObject({
      id: "S1", sid: "S1", mode: "business", city: "los_angeles", propertyId: 83684,
      propertyType: "Office", subtype: "Office_Medical", buildingClass: "A", sprinkler: "esfr",
      parkingSpaces: 20, zoning: "LAC4", elevator: true, stories: 11, address: "11645 Wilshire Blvd, Los Angeles, CA",
    });
    expect(s.useTags).toContain("medical");
  });

  it("matches the listing space by suite number for area, rate and status", () => {
    expect(s.sqft).toBe(9170);
    expect(s.sqftSource).toBe("listing space");
    expect(s.listing).toMatchObject({ listingId: 3926912, status: "active", kind: "lease", askingRate: 42, availableSqft: 9170 });
    expect(s.listing?.contact?.name).toBe("Cody Powers");
  });

  it("leaves unknown power as null rather than false", () => {
    expect(s.heavyPower).toBeNull();
    expect(s.driveInBays).toBeNull();
  });

  it("sends industrial properties to enterprise mode with power and bays", () => {
    const ind = shellFromCommercial(
      { ...property, propertyType: 6, propertySubtype: 601, propertyOffice: undefined, sprinklerType: 1,
        propertyIndustrial: { rentableBuildingAreaSquareFeet: 40000, electric: { hasHeavyPower: true }, driveInBays: { numDriveInBays: 2 }, numExternalLoadingDocks: 3, structural: { ceilingHeightFeet: 24 } } },
      undefined, [], { ...enums, PropertyType: { "6": "Industrial" }, PropertySubtype: { "601": "Industrial_Warehouse" } });
    expect(ind).toMatchObject({ id: "prop-83684", mode: "enterprise", heavyPower: true, driveInBays: 2, loadingDocks: 3, ceilingFt: 24, sprinkler: "wet", sqft: 40000 });
    expect(ind.sid).toBeUndefined();
  });

  it("keeps the building area for a scanned industrial property", () => {
    const ind = shellFromCommercial(
      { ...property, propertyType: 6, propertySubtype: 601, propertyOffice: undefined, propertyIndustrial: { rentableBuildingAreaSquareFeet: 40000 } },
      { sid: "S9", name: "9750 Tanner Rd" }, [], { ...enums, PropertyType: { "6": "Industrial" }, PropertySubtype: { "601": "Industrial_Warehouse" } });
    expect(ind).toMatchObject({ sid: "S9", sqft: 40000, sqftSource: "building record" });
  });

  it("does not read 'space' as a spa", () => {
    const s = shellFromCommercial({ ...property, propertySubtype: 0 }, { sid: "S2", name: "Office Space - Suite 200" }, [], enums);
    expect(s.useTags).not.toContain("salon");
  });
});

describe("shellFromResidential", () => {
  it("maps a Homes.com listing to a home shell", () => {
    const r = {
      id: 181343128, listingStatus: 1, currentPrice: 280000, transactionType: 1,
      property: { bedsMax: 4, bathsMax: 2, sqftMax: 1436, yearBuilt: 1952, totalParkingSpaces: 3, mlsPropertyType: "Residential, Detached", url: "TX/Houston/9117-Richland-Drive",
        address: { fullStreetAddress: "9117 Richland Drive", city: "Houston", state: "TX", latitude: 29.8, longitude: -95.2 } },
      media: [{ videoKey: "Ki9YdfpNKum", threeDimensionalScanType: 36 }],
    };
    expect(shellFromResidential(r)).toMatchObject({
      id: "Ki9YdfpNKum", sid: "Ki9YdfpNKum", mode: "home", city: "houston", beds: 4, baths: 2, sqft: 1436, sqftSource: "listing",
      parkingSpaces: 3, homesListingId: 181343128, listing: { listingId: 181343128, status: "active", kind: "sale", price: 280000, url: "https://www.homes.com/property/TX/Houston/9117-Richland-Drive" },
    });
  });
});
