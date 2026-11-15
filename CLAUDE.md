# Hermit — Build Brief

> **Purpose:** Find spaces that already fit a user's intended use, show the physical evidence, and identify the work still required. This is a screening and discovery tool—not an inspection, code-compliance certificate, or live availability guarantee.
>
> **Implementation details:** `docs/DESIGN.md` is the source of truth for data contracts, tools, algorithms, and routes. Build in milestone order; verify an external field or API before depending on it.

## 1. Product and decision

**Pitch:** “Tell Hermit what you need. It finds the space already built for it—and shows what's left to do.”

Users currently piece together property records, tours, and site imagery to discover expensive dealbreakers. Hermit combines **CoStar** (building/listing facts), **Matterport** (interior geometry/visual evidence), and **Vexcel** (site/roof/parking context) into a ranked, evidence-backed **Shell Report**. The primary action is to open a listing or copy an inquiry—not send messages automatically.

**Modes and evidence:**

| Mode | Job | Strongest evidence | Availability constraint |
|---|---|---|---|
| Home | Compare a home/unit with requirements and listing claims | Homes.com + Matterport | Strong scanned inventory; distinguish listing vs measured facts |
| Business | Find a space needing minimal conversion | Property subtype + suite room graph | Commercial scans are sparse; prefer like-for-like uses |
| Enterprise | Screen industrial/site requirements | CoStar power, bays, sprinklers, area + Vexcel | Record-first; scans optional |

**Dataset reality:** The supplied index has 14,944 scans concentrated in Houston and Los Angeles. Its “commercial” category contains mostly apartment units/amenities, not actual commercial suites. Rough planning counts: ~8,200 units, ~1,930 homes, ~480 office suites, 2 medical, ~4 salons and ~10 retail; these are name-derived and must be verified against Matterport classifications. Never present record-only evidence as scan verification. Do not assume current listing availability unless the kit supports it.

## 1a. Current state (updated Nov 15)

- **Two catalogs exist and are being merged** (`pipeline/merge-catalog.ts`):
  - **Supabase Postgres** (`DATABASE_URL`): 2,659 shells built from the CoStar kit, with 1,406 room graphs. Coverage: parking 2,142; listings 2,488; subtype 2,187; zoning 671; sprinklers 179; tenant brands 0. The catalog is copied into local SQLite at boot (`lib/db/catalog.ts`).
  - **Local `data/processed/shells.json`:** all 14,944 index rows with scan fields (`kind`, `scanClass`, `measuredSqft`), but no CoStar fields. Also holds 574 room graphs, 568 neighborhood `site/` files, floor plans and replays.
- **Vexcel works** (`VEXCELAPIKEY`, `api.vexcelgroup.com/v2`).
  - Parking stalls and rooftop units are counted on the cached ortho by `gemini-3.8-flash` (`pipeline/aerial.ts` → `data/processed/aerial/<sid>.json`, loaded with `lib/vexcel/count.ts`).
  - Counts are labeled "around the building" unless clipped to the lot.
- **Matterport panoramas are real photos,** six 2k cube faces per panorama.
  - "Hermit looked closer" maps each panorama to a room by point-in-polygon and asks Gemini whether a feature is visible (`pipeline/panos.ts` → `data/processed/panos/<sid>/checks.json`, loaded with `lib/vision/pano.ts`).
  - Results are `seen`, `not_seen` or `unclear`, always with the photo. No hand labels and no accuracy claims.
- **The planner is Gemini** (`GEMINI_API_KEY`). It uses Claude only if `ANTHROPIC_API_KEY` is set. No key is needed.
- **Routes:**
  - `/` hero
  - `/studio` Find a space: chat interview with the Layout Studio, then Matching Spaces
  - `/shell/[id]?run=` Shell Report, with tabs Overview · Inside & furnish · Neighborhood · Lease coach · Talk to your broker
  - `/packet/[run]/[shell]`, `/saved`, `/messages`
  - `/search`, `/chat`, `/address` and `/layout` redirect to `/studio`
- **Images** are served by `app/api/asset/[sid]?kind=floorplan|aerial|pano&f=`.
- **Demo story:** Dr. Priya, a pediatric clinic in Houston (hero `x37LjPx62VA`). The recorded replay plays offline.

## 1b. UI rule: a non-technical owner reads every screen

- One plain sentence plus a photo per finding. Details go behind a small "How we know" link, never on the page by default.
- No number fluff, no new tabs, no new pages in the nav. Don't add side features (address lookup, more lease tools). Don't remove existing ones without asking.
- No fake data: if something wasn't counted or seen, say so ("couldn't tell"), and turn it into a question.

## 2. User experience

1. **Intake (under 45 seconds):** city, mode, intended use, size/headcount, budget/timeline, must-haves, accessibility, optional TI/free-rent inputs.
2. **Express needs:** voice/text, drag-and-drop room layout, or survey only. All paths produce an editable `RequirementSpec` (room counts, size, adjacency, fixtures, and hard vs soft constraints).
3. **Search and investigate:** screen candidates cheaply, inspect stronger evidence only for promising properties, and change course when evidence contradicts a candidate.
4. **Shell Reports (up to five):** ranked fit, matching/missing requirements, Matterport Inside, Vexcel Above, floor-plan Fit overlay, rule flags, construction delta, weeks-to-open range, unknowns, sources, and an inquiry draft.
5. **Trace:** show meaningful `plan`, `tool`, `drop`, and `escalate` events; a real evidence-driven rerank/drop/escalation must be demonstrable.

## 3. Architectural choices (and why)

| Choice | Rationale |
|---|---|
| Preprocess external datasets into a private CSV/JSON bundle | Fast, reproducible retrieval; low API cost; resilient hackathon demo |
| In-memory structured filtering before expensive spatial analysis | 14.9k scans do not belong in an LLM prompt; hard constraints belong in code |
| Claude orchestrates; deterministic tools calculate | Flexible evidence-driven planning without hallucinated geometry or compliance |
| Candidate funnel: 50 → 20 → 8 → ≤5 | Reserve room-graph and vision analysis for plausible matches |
| Batch independent candidate reads; bounded concurrency for I/O | Reduce latency while protecting tool/compute budgets |
| Every claim contains a source reference and confidence | Differentiate observed facts, proxies, inferences, and unknowns |
| Cached artifacts + recorded replay | Demo remains usable when live providers or venue Wi-Fi fail |

This is **tool-augmented/agentic retrieval**, not an embeddings-first vector RAG system. Semantic interpretation builds the structured spec; indexed records retrieve candidates; spatial/rules tools verify fit. Add embeddings only if structured filtering fails an actual query need.

## 4. MVP boundaries

**Ship:** survey + three input modes; editable specs; local candidate query; agent trace and branching; room graph/area; layout assignment; electrical/HVAC/fire/parking/zoning/accessibility screening; cached Vexcel view; Matterport tour where available; ranked reports; citations and uncertainty; one or two Home-mode listing checks; chat-driven layout and fit-out edits (Claude picks typed ops, code applies and rescores them; see `docs/DESIGN_EDITS_PLAN.md`).

**Stretch, in order:** verified fixture tags → walkability/foot-traffic proxies → expanded enterprise screens → landlord reverse match → extra panorama inspection. Offline fixture detection is optional if precision is not demonstrated; geometry-only matching is an explicit fallback.

**Not in scope:** live nationwide inventory, certified permitting conclusions, unseen infrastructure verification, precise construction bids, auto-contacting agents/landlords, or building a generalized multi-agent platform.

## 5. Evidence and safety rules

- Use only **verified field names** from the provided CoStar `openapi.yaml`; null values are `unknown`, not `pass`.
- Keep CoStar source records, `models_index.csv`, assets, panoramas, and credentials private. Public repo contains synthetic sample data only.
- Every number or claim links to a CoStar field, `sid`/room/panorama, Vexcel asset, or sourced rule row; no invented “verified” labels.
- Scan geometry may suggest fixtures/areas; it cannot establish concealed utilities, actual equipment capacities, or legal compliance.
- Zoning, ADA, parking, life-safety, HVAC, and cost outputs are **screening flags/ranges** with cited assumptions. Unknowns become landlord/inspector questions.
- Label foot traffic/walkability as **proxies**. Do not describe a property as available without supporting listing evidence.
- Draft inquiries only; never send them.

## 6. Milestones and acceptance gates

1. **Data gate:** inspect kit/OpenAPI and Matterport metadata; verify commercial joins, inventory classifications, zoning sources, and at least 10 non-apartment scans across two business uses. If inventory/listing evidence fails, lead with Home + Enterprise, label Business record-only.
2. **Bundle gate:** build joinable `shells.csv`, room graphs, site context, and cached hero assets; synthetic local bundle boots without credentials. Verify specific hero candidates before demo use.
3. **Matching gate:** parse a `RequirementSpec`, retrieve top 50, screen top 20, analyze up to 8, and produce ≤5 sourced reports. Hard failures remove candidates; unobserved requirements remain unknown.
4. **Agent gate:** show at least one real evidence-driven `drop`, `escalate`, or top-pick change; trace each tool result with source/result ID. Stay within budgets in `docs/DESIGN.md`.
5. **UI/demo gate:** working Inside/Above/Fit tabs, readable report and trace, keyboard access, a live run target under 45 s, and an offline replay that does not depend on new API requests. Provide a static fallback if the remote Matterport Showcase cannot load.

**Order of work:** validate data → build local bundle → deterministic matching → agent loop → report UI → replay and accessibility → optional vision. Do not spend time on richer agents or branding before the data gates pass.
