# Hermit — Technical Design

**Stack:** Next.js App Router + React + TypeScript (Vercel/Node runtime), Anthropic SDK for orchestration, Python for offline vision. **Intent:** a small tool-augmented retrieval system with explainable, reproducible spatial screening. See `../CLAUDE.md` for product scope, constraints, and acceptance gates.

## 1. Runtime architecture

```text
Browser
  /plan: survey | text/voice | layout -> editable RequirementSpec
  /results: ranked shells | Inside | Above | Fit | Shell Report | live trace
       | POST /api/spec; POST /api/agent (SSE)
Next.js route handlers (Node)
  /api/spec       Claude tool-forced RequirementSpec (text only)
  /api/agent      budgeted agent loop + TraceEvent SSE + ShellReport[]
  /api/shell/:id  cached Shell Report
  /api/asset/:key cached site clips, floor plans, evidence crops
       |
  lib/query       private CSV tables in memory; JSON lazy per sid; geo index
  lib/reason      deterministic fit/area/rules/work/verification
  lib/agent       registry, scheduler, budgets, citations, replay
       |
Private precomputed bundle <- offline ETL / Matterport / Vexcel / OSM / zoning / vision
```

**Why offline-first:** CoStar/Matterport/Vexcel/OSM/zoning bulk calls run once in `pipeline/`, not on each search. User queries access compact local evidence; only Claude orchestration and narrowly targeted cached-crop inspection need live inference. Matterport Showcase is a **separate browser-loaded remote 3D experience**; provide cached screenshots/floor plans when offline. Replay removes live inference and replays recorded reports/trace; it cannot make uncached 3D tours offline.

## 2. Data ingestion, joins, and storage

**Sources and roles**

| Source | Retained evidence |
|---|---|
| `models_index.csv` (14,944 scans) | `sid`, location, CoStar/Homes join keys, `pano_count`, room/floor counts, classification clues |
| CoStar kit (`openapi.yaml`) | property/listing facts, prior use, power, RBA, sprinklers, parking, industrial details, rents, occupancies |
| Matterport GraphQL | rooms, polygons, dimensions, wall/door graph, panos/sweeps, floor plans; Showcase for visualization |
| Vexcel | REST v2 (`X-API-KEY`): `POST /ortho/extract` (layers `urban,urban-r,wide-area,urban-g`) and `POST /oriented/extract` (layer `urban`, `oblique-{north,east,south,west}`), 40 m around the record point, cached to `data/processed/vexcel/`; served by `/api/vexcel/[id]?view=`. Roof/site attributes (`/property/extract`) not yet used |
| OSM + LA zoning | nearby amenities/transit/lot polygons, parcel-level zone and allowed-use lookup (when verified) |
| LA zoning (verified 2026-11-14) | SCAG regional parcel zoning, `https://maps.scag.ca.gov/scaggis/rest/services/LDX/Zoning_poly_LA/MapServer/0/query` point query (`geometryType=esriGeometryPoint`, `inSR=4326`), field `ZN24_CITY` = city base zone (no height district), `APN24` = parcel. Matched CoStar on 3 of 6 spot checks (C4, CR, C2); others differ (MU/C4, M1/MR1), used as a cross-check, not ground truth. |

**Join strategy:** `models_index.costar_property_id` → commercial building ID; `homes_listing_id` → residential listing ID; occupancy `addressId` → commercial property-address ID; additional scan IDs via attachment type 43 or external reference type 36. Use geographic joins only for local context, with distance and provenance. Suite-level ID/area inferred from scan names is **best-effort**; do not conflate building RBA with available suite area. Validate actual kit keys and field population before shipping.

**Offline pipeline** (`pipeline/`, repeatable and rate-limited):

1. Normalize index and CoStar records; verify `PropertySubtype` and listing fields against OpenAPI; classify unit/amenity/suite/home using API metadata when possible.
2. Build property + listing joins and `shells.csv`. Extract relevant commercial scans, a small residential comparison sample, and verified hero homes.
3. Pull Matterport room geometry/sweeps once; compute and store `roomgraphs/{sid}.json`, floor plans, and optional fixture metadata.
4. Prefetch Vexcel orthophotos near candidates, OSM cluster features, LA zoning; save image bounds and citations. Houston zoning is recorded as not applicable; deed restrictions remain unknown.
5. Optionally run the Python vision pipeline; save crops and detections. Produce `site/{key}.json`, `fixtures/{sid}.json`, and recorded `replay/{runId}.json`.

**Private bundle** (target <25 MB excluding media):

```text
data/processed/                     # gitignored; fetch from private storage at cold start
  shells.csv                       # one row per candidate + normalized search fields
  occupancies.csv                  # nearby brands/addresses
  roomgraphs/<sid>.json            # rooms, polygons, connectivity
  fixtures/<sid>.json              # detected fixtures + provenance
  site/<key>.json                  # zoning, roof/parking, transit, proxy inputs
  assets/                          # aerials, plans, crops (may live in private object storage)
  replay/<runId>.json              # deterministic demo trace/results
```

Cache parsed CSV tables per server instance; lazily read detailed JSON by `sid`. Asset IDs should be opaque and validated to prevent arbitrary-file reads. Public repo includes only `data/sample/` (synthetic).

## 3. Domain contracts

```ts
type Mode = 'home' | 'business' | 'enterprise';
type City = 'los_angeles' | 'houston';

type RoomReq = {
  label: string; count: number; minSqft?: number; maxSqft?: number;
  adjacentTo?: string[]; fixtures?: string[]; hard: boolean;
};
type RequirementSpec = {
  mode: Mode; city: City; useType: string;
  sizeSqft?: [number, number]; headcount?: number; beds?: number; baths?: number;
  budgetMonthly?: number; moveInBy?: string; rooms: RoomReq[];
  needs: { kitchen?: boolean; threePhase?: boolean; heavyPower?: boolean;
    parkingStalls?: number; groundFloor?: boolean; stepFree?: boolean;
    wheelchair?: boolean; outdoorArea?: boolean; driveInBays?: number;
    esfr?: boolean; };
  priorities: Partial<Record<string, 1 | 2 | 3>>;
  tiPerSqft?: number; freeRentMonths?: number;
  input: 'voice' | 'text' | 'layout' | 'survey'; rawText?: string;
};
type Evidence = { source: string; ref: string; confidence: number };
type RuleHit = {
  rule: string; status: 'pass' | 'fail' | 'warn' | 'unknown';
  detail: string; citation: string; evidence: Evidence[];
};
type FitResult = {
  score: number; assignment: { req: string; roomId: string | null; cost: number }[];
  edits: string[]; breakdown: Record<string, number>; hardFails: string[];
};
type ShellReport = {
  shellId: string; rank: number; verdict: string; summary: string;
  fit: FitResult; rules: RuleHit[]; work: WorkItem[];
  weeksToOpen: [number, number]; costRange?: [number, number];
  unknowns: { topic: string; question: string }[];
  inside?: { sid: string; sweepId?: string };
  above?: { asset: string; overlays: Overlay[] };
  draftMessage: string; badge: 'scan-verified' | 'record-only';
};
// WorkItem and Overlay are typed in lib/types.ts; retain qty, low/high cost,
// low/high weeks, reason ('fit'|'code'|'user'), source, and geometry metadata.
```

All tool responses include `resultId`, `source`, `confidence`, and applicable record/asset/rule references. Every report claim should resolve to at least one returned evidence reference. Validate tool args/responses with Zod.

## 4. Retrieval and agent execution

**Why no vector DB:** user requests map naturally to structured filters (city, use, size, parking, power, room requirements). CoStar and spatial graph facts should be compared deterministically. The LLM converts ambiguous intent to `RequirementSpec` and chooses which evidence to inspect; it is not the database or the geometry engine.

**Search funnel:**

1. `search_shells(spec)` reads `shells.csv`, rejects wrong city/mode, non-existing construction, incompatible size, and true hard industrial constraints; ranks by prior-use subtype, class, scan evidence. Returns **top 50** with explanations. Missing fields do not silently pass hard requirements.
2. Batch `site_context` for **top ~20** to detect obvious site/parking/zoning/roof conflicts from cached evidence.
3. Batch/evaluate **up to 8** promising candidates using room graphs, `fit`, `check_rules`, and `estimate_work`; drop documented hard failures. Room graph reads are limited to 8 candidates.
4. If an uncertain top candidate could change rank, request narrowly targeted cached fixture/panorama verification (≤4 views); otherwise keep it unknown.
5. Return **up to 5** `ShellReport`s. Stream meaningful `plan`, `tool`, `drop`, `escalate`, and `report` events with `resultId`s throughout.

**Tool registry** (model-facing or internal batch variants):

| Tool | Output | Relative cost |
|---|---|---|
| `search_shells` | shortlist and screening reasons | cheap |
| `site_context` | zoning, parking, rooftop, OSM/transit, aerial asset | cheap/local |
| `room_graph` | labeled rooms, area, polygons, adjacency | costly payload, ≤8 |
| `fit` | room assignment, score, edits, hard failures | local compute |
| `check_rules` | HVAC/electric/fire/parking/ADA/zoning/permit flags | local compute |
| `estimate_work` | cited cost and duration ranges | local compute |
| `fixtures`, `verify_size` | precomputed detections/listing discrepancy | optional |
| `inspect_view` | question-specific Haiku judgment on **cached** crops | inference, ≤4 |
| `draft_message`, `submit_reports` | inquiry text; terminal reports | local/final |

**Concurrency/budgets:** target ≤25 **model-visible** tool calls per run, ≤8 candidate room graphs, ≤4 `inspect_view` calls, <45 seconds live. A literal `20 site_context + 8 × (room_graph + fit + check_rules)` exceeds 25 calls; **therefore implement batch endpoints/composite evaluation** that return compact per-candidate summaries. Run independent local lookups and I/O concurrently with a bounded limiter (not unbounded `Promise.all`), cache by normalized argument hash, and send only IDs + concise summaries to the model. Do not claim actual multithreaded CPU parallelism from Promise concurrency. The SDK's manual agent loop can execute independent tool uses in the same iteration; ordering dependencies stay sequential.

**Real agentic branching:** after inspecting evidence, the model must be able to drop a candidate, escalate a specific uncertainty, or reorder the shortlist. Do not hard-code a fixed chain and ask the model merely to narrate it. Stop when `submit_reports` is called, the model finishes, or budget/time expires; partial results should remain usable.

## 5. Deterministic scoring and evidence

**Room fit:** From a Matterport room graph `{rooms: polygons/areas/labels, edges: door|possible}`, form a cost matrix over required vs observed rooms: size mismatch + label mismatch + missing fixture + adjacency penalty. Solve minimum-cost assignment via the **Hungarian algorithm**. Model allowable edits explicitly (merge adjacent rooms, divide oversized rooms, add fixtures); unassigned required rooms become construction items. Use priority-weighted category scores (0–100); hard failures zero eligibility and must cite evidence. “Possible” adjacency is not verified door access.

**Measured size:** derive planar polygon areas via shoelace; distinguish net labeled area, unlabelled area, and estimated gross footprint. Sanity-check against Matterport dimensions. In Home mode, compare against advertised size and building-level median calibration; flag >10% deviations as screening discrepancies, not fraud.

**Checks (source JSON in `rules/`):**

| Module | Compare / output |
|---|---|
| HVAC | sourced use-based load range vs rooftop/cooling evidence; actual capacity usually **unknown** |
| Electrical | equipment/use assumptions vs CoStar amps/volts/phases/heavy power; null → unknown |
| Fire/industrial | sprinkler type, drive-in bays, loading, high-piled storage assumptions; do not certify code |
| Parking | city/use screening need vs recorded/visible surface stalls; garages uncountable from air |
| Zoning/permits | verified LA parcel zone + allowed-use table; Houston deed restrictions question |
| Accessibility | room/hall geometry, step-free path/elevator evidence; alteration review and cited ADA screening assumptions |
| Foot traffic/walkability | nearby occupancies, OSM/transit proxies, explicitly labeled proxies |
| Work/time | missing rooms/fixtures + conversion/code flags; low/high costs and weeks from sourced local rules |

Do not turn an image detection into proof of hidden plumbing, electrical service, or permit approval. A detector's raw score is not a calibrated probability. Rules and cost ranges require URL references and an explicit date/version where applicable; jurisdiction-dependent conclusions are flags for review. Free rent and TI adjustments are optional inputs, not guaranteed savings.

**Optional offline vision:** skybox → perspective crops (90° FOV; overlapping yaw/pitch) → OWLv2 fixture candidates → Haiku verification on uncertain crops → raycast into wall graph to map room/position → dedup with ~0.5 m clustering. Evaluate precision/recall on ~10 hand-labeled suites before promoting any output to verified tags; otherwise ship geometry-only fit.

## 6. UI and API delivery

**Pages:** `/` (pitch/start), `/plan` (survey + text/voice/layout + editable spec chips), `/results` (three-column shortlist / Inside–Above–Fit viewer / Shell Report, with trace below), `/shell/[id]` (shareable printable report).

**Key interaction:** selecting a shell updates the map/3D viewer, fit overlay, and evidence-linked report. The ghost layout is scaled to the candidate floor plan and assigned to measured room centroids; unmatched blocks are marked “build.” Shell cards show rank, score, three concise reasons, and `scan-verified` vs `record-only`.

**Streaming:** `/api/agent` emits typed SSE `TraceEvent`s, then reports; show progressive progress and error boundaries. `?replay=<runId>` streams recorded events, requiring no API calls; display cached static visuals when a remote 3D tour cannot load. `/api/spec` uses forced-schema Claude tool output for language inputs; survey/layout transform deterministically.

**UI/accessibility:** a calm tide-pool palette (`#E3F0EC` background, `#14213D` ink, `#1F5E57` actions, `#F4A99A` highlight, `#B23A28` failures), Atkinson Hyperlegible body + Young Serif headings, WCAG 2.2 AA targets, keyboard-operable room builder, text equivalents for imagery, focus visibility, reduced-motion handling.

## 7. Build map, deployment, and validation

```text
app/{page.tsx,plan/,results/,shell/[id]/,api/}
components/{Survey,SpecChips,LayoutBuilder,ShellList,InsideView,AboveView,FitView,ReportPanel,TraceDrawer}
lib/query/{load,shells,joins,geo}.ts
lib/reason/{fit,area,hvac,electric,parking,zoning,ada,work,verify}.ts
lib/agent/{tools,prompt,loop,replay}.ts
lib/geometry/{polygon,raycast}.ts
pipeline/{etl,matterport,vexcel,osm,zoning}.ts
pipeline/vision/{crops,detect,verify,project,dedup,eval}.py
rules/{uses,hvac,electric,parking,permits,costs,durations}.json
```

Server-side secrets: Anthropic, Matterport pull, Vexcel, private bundle/storage. Only the domain-restricted Matterport **SDK** key may be browser-visible. At cold start, load private bundle tables into memory; use private object storage for heavier assets. Set Node route handler limits to match the deployment plan, and degrade gracefully on timeouts.

**Verify before implementation:** CoStar listing availability/rent/suite data and exact ID joins; Matterport `propertyClassifications`, `generatedDescription`, door/wall edge types and rate limits; Showcase SDK tags/domain access; Vexcel ancillary endpoint fields; LA zoning field schema and source. No invented API fields.

**Tests and exit criteria:** fixture precision/recall if shipped; area sanity checks; 20 repeat queries yielding stable top three; first SSE trace event <2 s; live result <45 s; zero-network replay with static evidence fallback; screen-reader/keyboard and 200% zoom pass; no unsupported compliance/availability claims. Prefer a runnable end-to-end demo over extra modules.
