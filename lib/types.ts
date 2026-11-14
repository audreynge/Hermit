import { z } from "zod";

export const Mode = z.enum(["home", "business", "enterprise"]);
export const City = z.enum(["los_angeles", "houston"]);
export type Mode = z.infer<typeof Mode>;
export type City = z.infer<typeof City>;

export const RoomReq = z.object({
  label: z.string(),
  count: z.number().int().min(1).default(1),
  minSqft: z.number().positive().optional(),
  maxSqft: z.number().positive().optional(),
  adjacentTo: z.array(z.string()).optional(),
  fixtures: z.array(z.string()).optional(),
  hard: z.boolean().default(false),
});
export type RoomReq = z.infer<typeof RoomReq>;

export const Needs = z.object({
  kitchen: z.boolean().optional(),
  threePhase: z.boolean().optional(),
  heavyPower: z.boolean().optional(),
  parkingStalls: z.number().int().nonnegative().optional(),
  groundFloor: z.boolean().optional(),
  stepFree: z.boolean().optional(),
  wheelchair: z.boolean().optional(),
  outdoorArea: z.boolean().optional(),
  driveInBays: z.number().int().nonnegative().optional(),
  esfr: z.boolean().optional(),
  parking: z.boolean().optional(),
  transit: z.boolean().optional(),
});

export const RequirementSpec = z.object({
  mode: Mode,
  city: City,
  useType: z.string().min(1),
  sizeSqft: z.tuple([z.number().nonnegative(), z.number().positive()]).optional(),
  headcount: z.number().int().positive().optional(),
  beds: z.number().int().nonnegative().optional(),
  baths: z.number().nonnegative().optional(),
  budgetMonthly: z.number().positive().optional(),
  budgetTotal: z.number().positive().optional(),
  moveInBy: z.string().optional(),
  rooms: z.array(RoomReq).default([]),
  needs: Needs.default({}),
  priorities: z.record(z.string(), z.union([z.literal(1), z.literal(2), z.literal(3)])).default({}),
  tiPerSqft: z.number().nonnegative().optional(),
  freeRentMonths: z.number().nonnegative().optional(),
  transaction: z.enum(["lease", "buy"]).optional(),
  preferences: z.array(z.string()).optional(),
  input: z.enum(["voice", "text", "layout", "survey", "chat"]),
  // Drawn room blocks in feet; drives layout-similarity matching. Scale comes from sizeSqft vs drawn area.
  layout: z.array(z.object({ label: z.string(), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })).max(80).optional(),
  rawText: z.string().optional(),
});
export type RequirementSpec = z.infer<typeof RequirementSpec>;

export type Evidence = { source: string; ref: string; confidence: number };

export type Room = {
  id: string;
  label: string; // normalized: office, bathroom, kitchen, hallway, bedroom, living, storage, utility, open, other
  rawTags: string[];
  areaSqft: number;
  heightFt?: number;
  polygon: { x: number; y: number }[]; // meters, Matterport floor plane
  floorId: string;
  sweeps?: { id: string; index: number }[];
  proposed?: boolean; // changed by a user fit-out edit, not measured
  parts?: { x: number; y: number }[][]; // proposed merge: the original measured polygons
};
export type RoomGraph = {
  sid: string;
  name: string;
  classification?: string;
  totalAreaSqft: number;
  rooms: Room[];
  edges: { a: string; b: string; kind: "door" | "possible" }[];
  objects: { label: string; roomId: string | null; confidence: number; proposed?: boolean }[];
  panoCount: number;
  floorCount: number;
};

export type Listing = {
  listingId: number;
  kind?: "lease" | "sale";
  status: "active" | "off_market" | "sold" | "contract" | "other";
  askingRate?: number; // $/sf/yr for commercial leases
  price?: number; // homes: asking price or monthly rent
  availableSqft?: number;
  contact?: { name: string; company?: string; email?: string };
  url?: string;
};

export type Shell = {
  id: string;
  sid?: string;
  mode: Mode;
  city: City;
  name: string;
  address: string;
  lat?: number;
  lon?: number;
  propertyId?: number;
  homesListingId?: number;
  propertyType: string;
  subtype: string;
  useTags: string[];
  sqft?: number;
  sqftSource?: string;
  buildingSqft?: number;
  buildingClass?: string;
  yearBuilt?: number;
  stories?: number;
  constructionStatus?: string;
  sprinkler: "wet" | "dry" | "esfr" | "unknown";
  heavyPower: boolean | null;
  amps?: number;
  volts?: number;
  driveInBays: number | null;
  loadingDocks: number | null;
  ceilingFt?: number;
  parkingSpaces: number | null;
  parkingRatio?: number;
  zoning: string | null;
  elevator: boolean | null;
  beds?: number;
  baths?: number;
  listing?: Listing;
  roomCount?: number;
  panoCount?: number;
  nearbyTenants?: string[];
};

export type RuleStatus = "pass" | "fail" | "warn" | "unknown";
export type RuleHit = {
  rule: string; status: RuleStatus; detail: string; citation: string; evidence: Evidence[];
  reg?: { topic: string; jurisdiction: "city" | "county" | "state" | "federal"; requirement: string; certainty: "applies" | "may_apply"; retrievedAt: string };
};

export type FitResult = {
  score: number;
  assignment: { req: string; roomId: string | null; cost: number }[];
  edits: string[];
  breakdown: Record<string, number>;
  hardFails: string[];
  unknowns: string[];
};

export type WorkItem = {
  item: string;
  qty: number;
  low: number;
  high: number;
  weeksLow: number;
  weeksHigh: number;
  reason: "fit" | "code" | "user";
  source: string;
};

export type Overlay = { kind: "pin" | "radius"; lat: number; lon: number; label: string; radiusM?: number };

export type ShellReport = {
  shellId: string;
  rank: number;
  name: string;
  address: string;
  verdict: string;
  summary: string;
  matchScore: number;
  sqft?: number;
  useTags?: string[];
  reasons: string[];
  fit: FitResult;
  rules: RuleHit[];
  work: WorkItem[];
  weeksToOpen: [number, number];
  costRange?: [number, number];
  tiAllowance?: number;
  unknowns: { topic: string; question: string }[];
  inside?: { sid: string; sweepId?: string };
  above?: { lat: number; lon: number; provider: string; overlays: Overlay[] };
  floorplan?: RoomGraph;
  draftMessage: string;
  badge: "scan-verified" | "record-only";
  sources: Evidence[];
  listing?: Listing;
  similarity?: Similarity;
};

export type Similarity = {
  score: number;
  scale: number; // area multiplier applied to the drawn layout
  breakdown: { program: number; adjacency: number | null; size: number; shape: number };
  pairs: { mine: number; theirs: string }[]; // index into layout -> room id in the scan
  layout?: NonNullable<RequirementSpec["layout"]>; // the drawn design this was compared against (unscaled)
};

export type TraceEvent =
  | { type: "run"; id: string; runId: string; replay: boolean; spec?: RequirementSpec }
  | { type: "plan"; id: string; text: string }
  | { type: "tool"; id: string; tool: string; args: unknown; resultId: string; summary: string; ms: number }
  | { type: "drop"; id: string; shellId: string; reason: string; evidence: Evidence[] }
  | { type: "escalate"; id: string; shellId: string; question: string; outcome: string }
  | { type: "rerank"; id: string; order: string[]; reason: string }
  | { type: "report"; id: string; reports: ShellReport[] }
  | { type: "error"; id: string; message: string }
  | { type: "done"; id: string; ms: number; toolCalls: number; planner: "claude" | "gemini" | "openai" | "deterministic" | "replay" };
