# SpaceMatch — Design Doc

> **Instructions for Claude (read first)**
> - This is the source of truth for the SpaceMatch hackathon build. Read the whole doc before writing code.
> - Build in the milestone order in Section 17. Each milestone has acceptance criteria; do not start the next until the current one passes.
> - Items marked `TODO(verify)` are unknowns about the data or APIs. **Do not invent API fields.** List the tools exposed by the CoStar, Matterport and Vexcel MCP servers and inspect their schemas before writing integration code.
> - Example numbers in this doc (costs, counts, savings) are **illustrative**, not real data.
> - Prefer simple, working, end-to-end code over complete-but-broken code. Stub with clearly labeled fallbacks when a data source is missing.

---

## 1. Summary

**Customer pitch:** "Tell us your business. We'll find spaces already built for it, and show you exactly how much you'll save."

**Technical pitch:** "We turn every Matterport scan into a room graph, match it against what your business needs, check local constraints, and calculate exactly what you'd have to build. The difference is your savings."

**What it is:** An AI agent that helps small business owners (dental offices, restaurants, salons, gyms, daycares) find available commercial spaces whose existing buildout already fits their business. It searches CoStar listings, inspects Matterport scans to see what is built inside, checks the site with Vexcel aerial imagery, checks local constraints (permitted use, HVAC, health and fire requirements, parking, accessibility), estimates buildout savings with a cost range, and then acts: it emails brokers with targeted questions, proposes tour times, and produces a shortlist report.

---

## 2. Hackathon context

**Track:** "Inside and Out: AI for the Built World" by CoStar Group (CoStar data + Matterport 3D scans + Vexcel aerial imagery for Houston and Los Angeles), plus the **Business and Enterprise** main track (financial tools for startups, analytics, dashboards).

**Judging rubric and how SpaceMatch earns each part:**

| Criterion | Weight | How SpaceMatch earns it |
|---|---|---|
| Use of the data | 30% | CoStar = available spaces, rents, prior tenant use. Matterport = room graph + fixtures. Vexcel = parking, frontage, rooftop HVAC, outdoor space. Each layer answers a different question; combined they produce a construction delta no single layer can. |
| Agentic depth | 30% | Plans a cost-aware funnel, decides when to gather more evidence, runs a constraints sub-agent, solves an optimization problem, and takes actions (broker emails, tour scheduling, report). |
| Usefulness | 25% | Real user (small business owner) with a real dollar outcome. Self-serve, so it generates qualified leads for brokers without a sales rep. |
| Demo and polish | 15% | 3D tour with detected fixtures highlighted, a visible agent funnel, and a single clear savings number with a range. |

**Hard requirements from the track:** uses ≥2 layers (we use 3), agentic (not a chat wrapper), real problem for a real person, spatial and visual understanding.

---

## 3. Problem and users

**Problem:** Building out an empty commercial space is one of the largest startup costs for a physical business. Second-generation spaces (where a similar business already built out the space) save money and time, but listings do not reliably say what is inside, and owners cannot estimate adaptation cost until they tour with a contractor.

**Primary user:** Small business owner or startup founder opening a physical location. Not a real estate professional. Needs plain-language answers and dollar figures.

**Secondary users:**
- **Listing brokers and landlords:** receive pre-qualified tour requests with specific questions.
- **SBA / small business lenders:** can use the construction delta to size buildout loans.
- **CoStar:** gains verified, searchable interior features for listings and a self-serve channel to small business customers.

---

## 4. Strategic fit for CoStar (pitch material)

Use these in the pitch. Items are marked by confidence.

**Verified from public reporting:**
- CoStar's CEO has emphasized that its advantage is proprietary, nonpublic data, saying "AI cannot create data from nothing." SpaceMatch is built on that thesis: CoStar's ground truth + scans + imagery, not public web data.
- CoStar has been reducing inside sales headcount on Homes.com while trying to grow; self-serve products that convert users without a sales rep align with that direction.

**Team notes — `TODO(verify)` a source before saying these on stage:**
- A public-data-only agent had a ~75% error rate in CoStar's tests, while proprietary data + AI (e.g., Tenant AI) raised researcher productivity more than tenfold.
- CoStar has ~2,000 sales professionals and lacks scale to reach hundreds of thousands of prospects.
- Only ~25% of CoStar's data is actively used.
- Competitive pressure from Zillow on consumer reach and immersive media.

**Framing:** SpaceMatch is a consumer-friendly (small business owner) front door to CoStar's commercial data, the way Homes.com is for residential. It makes underused data (interior scans, prior tenant use, aerial imagery) directly useful, and it converts searchers into qualified broker leads without sales reps.

---

## 5. Goals and non-goals

**Goals (MVP):**
1. Two business types end to end: **dental office** and **restaurant**.
2. Houston only, 10–20 candidate spaces, at least 5 with Matterport scans.
3. Room graph + fixture detection + fit matching + construction delta + savings range.
4. Site checks (parking count vs requirement) and local constraint checks.
5. Visible, cost-aware agent funnel.
6. Actions: targeted broker email draft/send, tour time proposals, shortlist report.

**Non-goals (do not build unless MVP is done):**
- Accurate contractor-grade quotes (we produce screening ranges).
- Lease negotiation.
- Foot traffic modeling (no frequent data in the dataset; see Section 19).
- Los Angeles (stretch), more business types (stretch).
- User accounts, payments.

---

## 6. Glossary

- **Second-generation space:** A space previously built out for a similar use.
- **Business spec:** Machine-readable requirements for a business type (rooms, fixtures, systems, site, constraints).
- **Room graph:** Graph built from a scan; nodes are rooms (with area, dimensions, ceiling height), edges are doorways.
- **Fixture:** Detected object that matters for buildout (sink, toilet, hood, floor drain, shower, exam chair).
- **Wet wall:** Wall where plumbing already runs, inferred from clusters of plumbing fixtures.
- **Construction delta:** The list of physical changes needed to make a space fit the spec.
- **Savings:** Cost to build the business from an empty shell minus cost of the construction delta.
- **Funnel:** Staged search from cheap filters to expensive analysis.

---

## 7. System overview

```
User request ("12-chair dental office, Houston, $8,000/mo")
        │
        ▼
┌─────────────────────────────┐
│ Orchestrator agent (Claude) │◄──── RAG: business specs, unit costs,
└──────────────┬──────────────┘      parking rules, local constraints
               │ plans funnel, calls tools, decides next step
   ┌───────────┼──────────────┬───────────────┬────────────────┐
   ▼           ▼              ▼               ▼                ▼
Stage 1     Stage 2        Stage 3         Stage 4          Stage 5
CoStar      Vexcel site    Matterport      Constraints      Actions
filter      checks         scan analysis   sub-agent        (email, tours,
(cheap)     (moderate)     (expensive)                      report)
   │           │              │               │
   └───────────┴──────┬───────┴───────────────┘
                      ▼
          Fit matching + construction delta
                      ▼
          Savings estimate (Monte Carlo range)
                      ▼
          Ranked shortlist + UI (map, 3D tour, delta panel)
```

**Components:**
- **Orchestrator:** Claude with MCP tools.
- **Vision service:** Python workers for floor plan parsing, fixture detection, 3D placement, parking counts.
- **Spatial DB:** PostGIS (parcels, parking polygons, room geometry). SQLite + shapely is an acceptable fallback for speed.
- **RAG store:** pgvector or Chroma.
- **Frontend:** Web app with a results map, embedded Matterport tour, and a side panel.

---

## 8. Data sources

| Layer | What we use | Why | Freshness note |
|---|---|---|---|
| CoStar | Available spaces, size, asking rent, property type, location, **prior tenant use**, broker contact | Candidate set, budget fit, prior probability of features | Updates continuously |
| Matterport | Floor plans, measurements, panoramas, depth/mesh, viewer SDK for tags | Room graph, fixtures, 3D placement | Scans usually captured when a space is listed, so freshest for available spaces |
| Vexcel | Nadir (top-down), obliques, elevation data | Parking stall count, frontage/visibility, rooftop HVAC units, outdoor area, entrance access | Roughly annual captures; fine for static features |

**`TODO(verify)` before coding:**
- Which CoStar fields exist (prior tenant/use, space-level rent, broker contact)?
- Which Matterport outputs are accessible (floor plan, room labels, measurements, panoramas, depth/mesh, viewer SDK)?
- Which Vexcel products are accessible (obliques, elevation, multiple dates)?
- How to join the three layers (shared property ID, address, or coordinates)?

---

## 9. Data models

Use these as the canonical shapes (Python dataclasses or Pydantic models). Field names are ours; map provider fields into them.

```python
class BusinessSpec:
    business_type: str                 # "dental_office" | "restaurant"
    rooms: list[RoomReq]               # required room types
    fixtures: list[FixtureReq]
    systems: dict                      # {"plumbing": True, "gas": True, "min_amps": 200, ...}
    site: SiteReq
    constraints: list[str]             # ids of constraint checks to run (Section 12)
    shell_buildout_cost_per_sf: Range  # cost to build from empty shell (TODO(verify) source)
    shell_buildout_weeks: Range

class RoomReq:
    room_type: str                     # "operatory", "sterilization", "kitchen", "dining", "restroom"
    count: Range                       # e.g. {min: 6, max: 12}
    area_sf: Range
    adjacency: list[str]               # e.g. ["corridor", "sterilization"]
    hard: bool

class FixtureReq:
    fixture_type: str                  # "sink", "floor_drain", "hood", "toilet", "grease_trap"
    per_room_type: str | None
    count: Range
    hard: bool
    add_cost: Range                    # cost to add if missing

class SiteReq:
    parking_rule_id: str               # key into RAG parking rules
    needs_street_visibility: bool
    needs_outdoor_area_sf: float | None  # e.g. daycare (stretch)

class Space:
    space_id: str
    property_id: str
    address: str
    lat: float; lon: float
    area_sf: float
    asking_rent_month: float | None
    prior_use: str | None
    broker: dict | None                # name, email
    scan_id: str | None

class Room:
    room_id: str
    label: str | None                  # from Matterport if available
    area_sf: float
    dims: tuple[float, float]
    ceiling_ft: float | None
    polygon: list[tuple[float, float]]

class RoomGraph:
    rooms: list[Room]
    edges: list[tuple[str, str]]       # doorways
    fixtures: list[Fixture]
    wet_walls: list[Segment]
    coverage: float                    # share of space area covered by scan (0..1)

class Fixture:
    fixture_type: str
    room_id: str
    position_3d: tuple[float, float, float]
    confidence: float
    evidence_image: str                # path/url to crop

class SiteCheck:
    parking_count: Range
    parking_required: int
    parking_pass: bool
    frontage_ft: float | None
    rooftop_hvac_units: int | None
    notes: list[str]

class ConstraintResult:
    constraint_id: str                 # "permitted_use", "hvac", "grease_interceptor", ...
    status: str                        # "pass" | "fail" | "unknown"
    evidence: str
    cost_if_fail: Range | None
    question_for_broker: str | None

class DeltaItem:
    action: str                        # "remove_wall", "add_sink", "extend_plumbing", ...
    quantity: float
    unit: str                          # "each", "lf", "sf"
    cost: Range
    reason: str

class SavingsEstimate:
    delta_cost: Range
    shell_cost: Range
    savings: Range                     # p10, p50, p90
    weeks_saved: Range
    confidence: float

class Candidate:
    space: Space
    stage_reached: int                 # 1..4
    prior_score: float
    site: SiteCheck | None
    graph: RoomGraph | None
    constraints: list[ConstraintResult]
    delta: list[DeltaItem]
    savings: SavingsEstimate | None
    open_questions: list[str]
    rank_score: float
```

`Range` = `{min, likely, max}` (or `{p10, p50, p90}` for simulations).

---

## 10. Agent design

### 10.1 Orchestrator loop

```
parse request -> BusinessSpec (retrieve spec from RAG; fill budget, size, area)
stage 1: candidates = search_spaces(spec, budget, area)          # CoStar, ~hundreds
         score each with prior_score from prior_use; keep top ~50
stage 2: for top ~50: site = site_check(space, spec)              # Vexcel
         drop hard site failures; keep top ~10 (with scans first)
stage 3: for top ~10 with scans:
            graph = build_room_graph(scan)
            graph.fixtures = detect_fixtures(scan)
            if any fixture confidence in ambiguous band (0.4–0.7):
                get_extra_views(scan, fixture) -> re-verify
stage 4: constraints = check_constraints(space, spec, graph, site)   # sub-agent
fit:     delta = match_fit(graph, spec, constraints)
cost:    savings = estimate_savings(delta, spec, region)
rank:    rank_score = f(savings.p50, rent fit, site pass, constraint fails, confidence)
act:     for top 3: draft broker email with open_questions + proposed tour times
         generate shortlist report; place tags in 3D tour (if SDK available)
```

### 10.2 Decision rules
- **Cost-aware:** Never run Stage 3 on a candidate that failed a hard Stage 1 or 2 requirement.
- **Evidence gathering:** Request extra panoramas only for fixtures in the ambiguous confidence band, and only if that fixture affects the delta by more than a threshold (e.g., >5% of delta cost).
- **Unscanned spaces:** Keep them in results ranked by CoStar + Vexcel, labeled **"unverified interior"**.
- **Never claim absence:** If a fixture is not detected and scan coverage < 0.9, say "not observed in scanned area," and add a broker question.
- **Stop condition:** Stop analysis when the top 3 are stable (rank order unchanged after the last candidate) or when the candidate list is exhausted.

### 10.3 Visible reasoning
Every stage writes a log line the UI displays, e.g.:
- "Filtered 214 spaces → 41 (size, rent, area). Prioritized 9 former medical/dental uses."
- "Parking check: 12 of 41 meet the 1 per 200 sf requirement (rule TODO(verify))."
- "Sink in Room 4 uncertain (0.55). Checking a second panorama… confirmed (0.86)."

---

## 11. Tools

### 11.1 Provided MCP servers
CoStar, Matterport, Vexcel. **First task:** list their tools and record the exact names and schemas in `docs/mcp_tools.md`. Wrap them behind the custom tools below so the agent never calls raw provider tools directly.

### 11.2 Custom tools (expose as MCP tools)

| Tool | Input | Output | Notes |
|---|---|---|---|
| `search_spaces` | spec, budget, area, size range | list[Space] with prior_score | CoStar. Prior score from prior_use similarity to business type. |
| `site_check` | space, spec | SiteCheck | Vexcel. Parking stall segmentation/count, frontage, rooftop HVAC count. |
| `build_room_graph` | scan_id | RoomGraph (no fixtures) | Matterport floor plan + measurements → rooms, edges, coverage. |
| `detect_fixtures` | scan_id, fixture_types | list[Fixture] | Open-vocabulary detection on panoramas + VLM verification + 3D placement. |
| `get_extra_views` | scan_id, fixture | updated Fixture | Re-check from additional panoramas. |
| `check_constraints` | space, spec, graph, site | list[ConstraintResult] | Runs constraint sub-agent (Section 12). |
| `match_fit` | graph, spec, constraints | list[DeltaItem] | Assignment + modifications (Section 13.4). |
| `estimate_savings` | delta, spec, region | SavingsEstimate | Monte Carlo (Section 13.5). |

### 11.3 Action tools
| Tool | Purpose |
|---|---|
| `send_broker_email` | Draft and send (or save as draft in demo mode) an email with specific open questions and tour times. |
| `propose_tour_times` | Generate 3 time slots; optionally create calendar holds. |
| `place_scan_tags` | Place tags at detected fixture positions in the Matterport viewer (`TODO(verify)` SDK access). |
| `generate_report` | Shortlist report (Markdown/PDF/HTML) with annotated images, delta, savings range, site and constraint results. |

**Demo safety:** Default to **draft mode** for emails; a toggle sends to a team-controlled inbox, never to real brokers during the demo.

---

## 12. Local constraints sub-agent

Purpose: catch "this space looks right but you can't actually use it" problems. Runs per candidate after Stage 3. Each check returns pass/fail/unknown with evidence, a cost if it fails, and a broker question if unknown.

| Check | Applies to | Evidence source | Notes |
|---|---|---|---|
| Permitted use | All | RAG: city rules; CoStar property type | **Houston has no citywide zoning**, but deed restrictions and other ordinances apply; LA has zoning. Unknown → broker question. |
| Parking requirement | All | Vexcel count + RAG parking rule | Required spaces by use and area. |
| HVAC adequacy | Restaurant, gym, dental | Vexcel rooftop units (count/approx size); Matterport ducts/units; RAG rules of thumb | Restaurants need significant ventilation/make-up air. Flag if few/small rooftop units. |
| Kitchen hood + fire suppression | Restaurant | Matterport hood detection | Missing hood = large delta item. |
| Grease interceptor | Restaurant | Matterport (if visible), CoStar prior use, RAG health/utility rules | Usually not visible; default unknown → broker question. |
| Plumbing access | Dental, salon, restaurant | Wet walls from room graph | Drives plumbing extension cost. |
| Accessibility (restroom, entrance) | All | Matterport restroom size; Vexcel entrance/parking | Simplified screening only. |
| Electrical service | Dental, restaurant | Matterport panel (if visible); CoStar fields | Usually unknown → broker question. |
| Outdoor area (stretch) | Daycare | Vexcel measurable outdoor area | Daycares often need outdoor play space. |

All rule details live in RAG documents. **`TODO(verify)`** each rule from an official or reputable source; do not hardcode numbers from memory.

---

## 13. Algorithms

### 13.1 Room graph
1. Pull floor plan and measurements from Matterport. If room polygons exist, use them; otherwise segment the floor plan image into rooms (connected components on wall mask).
2. Compute area, bounding dims, ceiling height (from measurements/depth).
3. Edges: detect doorways (gaps between room polygons or door detections); connect rooms.
4. Coverage = scanned area / CoStar space area (cap at 1.0).

### 13.2 Fixture detection
1. For each panorama, run an open-vocabulary detector with prompts per fixture type (e.g., "sink", "toilet", "commercial kitchen hood", "floor drain", "dental chair").
2. For detections with confidence in the ambiguous band, crop and ask a VLM yes/no with a short rationale.
3. Deduplicate detections of the same object across panoramas (cluster by 3D position).

### 13.3 3D placement and wet walls
1. Use panorama pose + depth (or mesh raycast) to convert detection centers to 3D points.
2. Assign each fixture to the room polygon that contains its (x, y).
3. Wet walls: for plumbing fixtures, find nearest wall segment; cluster segments; each cluster = wet wall.
4. Plumbing extension distance for a needed fixture = distance from its target room to the nearest wet wall.

### 13.4 Fit matching → construction delta
1. Expand the spec into required room instances (e.g., 8 operatories).
2. Build a cost matrix: rows = required rooms, columns = scanned rooms (+ "build new" dummy columns).
   - cost = size mismatch penalty + missing fixtures add-cost + plumbing distance cost + adjacency penalty.
   - "build new" column cost = cost to construct that room in open area.
3. Solve with the Hungarian algorithm (`scipy.optimize.linear_sum_assignment`).
4. Post-process for modifications:
   - Two adjacent small rooms that together fit one required room → `remove_wall`.
   - One large room that fits two required rooms → `add_wall`.
5. Add delta items from constraint failures (e.g., `add_hood`, `upgrade_hvac`).
6. Each DeltaItem carries a reason string for the UI.

### 13.5 Savings estimate
1. Shell cost = space area × `shell_buildout_cost_per_sf` (Range).
2. Delta cost = sum of DeltaItem costs (Ranges).
3. Monte Carlo (e.g., 2,000 samples): sample each unit cost from its range; for each fixture with confidence c, sample presence ~ Bernoulli(c); if absent, add its add_cost.
4. Savings = shell − delta → report p10/p50/p90. Weeks saved computed the same way from timelines.

### 13.6 Prior from CoStar
- prior_score = similarity(prior_use, business_type) using a small lookup table in RAG (e.g., dental ← dental/medical: high; restaurant ← restaurant/café: high; office: low).
- Use prior_score for Stage 1 ranking and to set fixture priors when scan coverage is low.

---

## 14. RAG corpus

| Document set | Contents | Retrieval key |
|---|---|---|
| Business specs | One YAML/JSON per business type (Section 9 shape) | business_type |
| Unit costs | Cost ranges per action (wall, sink, plumbing lf, hood, restroom), with region factors for Houston/LA | action, region |
| Parking rules | Required spaces by use and area per city | city, use |
| Local constraints | Permitted use notes, health/fire basics, HVAC rules of thumb, accessibility basics | city, business_type, check_id |
| Timelines | Typical buildout and permitting durations | business_type, region |
| Prior-use table | Similarity between prior uses and business types | prior_use |

Keep each document short and structured (YAML/JSON preferred) so retrieval returns exact values. Store the source for every number. Mark unsourced values `TODO(verify)`.

---

## 15. Frontend / UX

**Screen 1 — Request:** One text box ("What business are you opening?") + optional budget, size, area fields parsed from the text.

**Screen 2 — Agent run:** Live funnel (counts per stage) and the reasoning log (Section 10.3).

**Screen 3 — Results:**
- Map of candidates (color = savings p50; gray = unverified interior).
- Ranked cards: address, rent, savings range, weeks saved, site pass/fail, constraint flags, confidence.

**Screen 4 — Space detail:**
- Embedded Matterport tour with fixture tags (or annotated panorama crops as fallback).
- Room graph visualization next to the tour.
- Construction delta table with reasons and costs.
- Site panel: Vexcel image with parking stalls/rooftop units overlaid.
- Constraints checklist with broker questions.
- Buttons: "Email broker," "Propose tour times," "Download report."

Plain language everywhere. Example: "This space already has 6 rooms with sinks. You'd need to remove 1 wall and add 2 sinks."

---

## 16. Demo script (~3 minutes)

1. **Problem (20s):** "Opening a dental office? Building out an empty space can cost six figures and months."
2. **Request (15s):** "12-chair dental office in Houston, $8,000 a month."
3. **Funnel (30s):** Counts drop stage by stage; log lines explain why.
4. **Top space (60s):** Former medical office. Tour shows highlighted sinks; room graph beside it; one ambiguous sink gets re-checked live. Delta: remove 1 wall, add 2 sinks on an existing wet wall.
5. **Constraints and site (25s):** Parking passes; HVAC looks adequate; electrical unknown → becomes a broker question.
6. **Result (15s):** "Saves $90k–$130k, most likely $110k, about 10 weeks." *(illustrative)*
7. **Action (15s):** Broker email drafted with the open questions and three tour times; report downloads.

**Close:** "Most of the cost of opening a business is building out the space. We find the spaces where that's already done."

---

## 17. Milestones and acceptance criteria

| # | Milestone | Acceptance criteria |
|---|---|---|
| M0 | Data access | `docs/mcp_tools.md` lists every tool and schema from the three servers. One Houston space fetched from each layer and joined. |
| M1 | Specs + RAG | Dental and restaurant specs, unit costs, parking rules, prior-use table loaded; retrieval returns exact values with sources. |
| M2 | Stage 1 | `search_spaces` returns ≥10 Houston candidates with rent, size, prior_use, scan_id where available. |
| M3 | Room graph | `build_room_graph` returns rooms, areas, edges and coverage for ≥5 scans. |
| M4 | Fixtures | `detect_fixtures` returns fixtures with room assignment and confidence on ≥5 scans; ambiguous re-check works. |
| M5 | Fit + delta | `match_fit` returns a delta with reasons for each scanned candidate. |
| M6 | Savings | `estimate_savings` returns p10/p50/p90 savings and weeks saved. |
| M7 | Site + constraints | `site_check` returns parking count vs requirement; `check_constraints` returns results with broker questions. |
| M8 | Orchestrator | End-to-end run from one text request to a ranked shortlist with visible log. |
| M9 | Actions | Broker email drafts, tour times, report generated. |
| M10 | UI | Screens 1–4 working with real data for the demo request. |
| Stretch | Tags in tour, LA, salon/gym/daycare, accuracy backtest. |

---

## 18. Evaluation

- **Fixture detection:** Hand-label fixtures in 10–15 scans; report precision and recall per fixture type.
- **Prior-use backtest:** For spaces with known prior use, hide it and check whether the room graph + fixtures predict it.
- **Agent behavior:** Report how often the agent asked a broker instead of guessing, and how many expensive scan analyses the funnel avoided.

Show these numbers in the demo or Q&A.

---

## 19. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Floor plans or room labels not available | Segment floor plan image; or use panorama clustering to approximate rooms. |
| Depth/mesh not available | Assign fixtures to rooms by panorama location instead of 3D position. |
| Viewer SDK not available | Show annotated panorama crops instead of tags. |
| Low scan coverage | Lower confidence, use CoStar prior use, ask brokers. |
| Cost data uncertain | Use ranges with sources; label as screening estimate. |
| Joining layers is hard | Join on property ID if available, else address/geo proximity with manual check for demo spaces. |
| Foot traffic requested by judges | Not available at useful frequency in this dataset. Optional proxy: nearby retail/co-tenants from CoStar. Do not claim measured foot traffic. |
| Real broker contact during demo | Draft mode only; team inbox for sends. |

---

## 20. Open questions (`TODO(verify)`)

1. Exact MCP tool names and schemas for CoStar, Matterport, Vexcel.
2. Does CoStar expose prior tenant/use and space-level rent and broker contacts?
3. Matterport: floor plans, room labels, measurements, panoramas, depth/mesh, viewer SDK?
4. Vexcel: obliques, elevation, multiple dates, rooftop resolution?
5. Shared identifier across layers?
6. Sources for unit costs, parking rules, and constraint rules (Houston and LA).
7. Sources for the CoStar strategy claims in Section 4.

---

## 21. One-paragraph summary for any new Claude session

SpaceMatch is a hackathon agent that helps small business owners find commercial spaces already built for their business. It filters CoStar listings (rent, size, prior use), checks sites with Vexcel imagery (parking, frontage, rooftop HVAC), turns Matterport scans into room graphs with detected fixtures and wet walls, runs a local-constraints sub-agent, matches the business spec to the space with the Hungarian algorithm to produce a construction delta, estimates savings with Monte Carlo ranges, and acts by drafting targeted broker emails, proposing tour times and generating a report. Build in milestone order (Section 17), never invent API fields, and label all uncertain values.