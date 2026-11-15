# Plan: plan-then-place for "furnish this room"

**Branch:** `furnish-planner`. **Problem:** "furnish this place" turned into a handful of `add` ops dropped in front of the
camera and scattered by `freeSpot`: chairs in the middle of the floor, nightstands nowhere near a bed, a desk blocking a door.
**Goal:** a planning layer decides *what* goes in each room (from the user's intended use, the prompt, the room's size,
doors and what the scan already shows) and *how the pieces relate*; a deterministic solver turns that into wall-aware,
collision-free positions.

**Core rule (unchanged):** the model picks items and roles; code computes every position. Placed furniture is a visualization,
not evidence.

## Flow

```
chat "furnish this place"
  → /api/furniture/edit   Gemini/offline → { op: "furnish", scope: room|all, room? }        (no positions)
  → client builds room context: polygon, ceiling, doors (doorPoint), scan objects, placed items   (same floor only)
  → /api/furniture/plan   planFurnish: Gemini/offline templates → RoomPlan per room (items + roles)
                          layoutRoom (pure): roles → positions, drops what doesn't fit
                          → add ops with exact pos/rotY + reply ("No room for: …")
  → applyFurnishOps (existing path: ids, ceiling, selection, model lookup)
```

## Plan contract (what the model returns, per room)

`{ key, name, terms, w, d, h, count, place, of?, wall?, priority }`

| place | meaning | needs `of` |
|---|---|---|
| `wall` | back against a wall, facing into the room | no |
| `corner` | wall position at the end of a wall | no |
| `center` | open middle of the room, aligned to the long wall | no |
| `grid` | repeated across the floor in rows with aisles (restaurant tables, retail racks, open-office desks) | no |
| `beside` | left/right of the anchor, backs aligned (nightstands, filing cabinet by desk) | yes |
| `front` | in front of the anchor; seats face it and tuck to its edge (desk chair), others sit 0.4 m off (coffee table) | yes |
| `behind` | the seat of someone working at the anchor, facing the room (receptionist); the anchor stands off its wall to make room | yes |
| `around` | seats on the anchor's sides, long sides first, each facing it (dining chairs) — `count` is per anchor | yes |
| `facing` | on the wall opposite the anchor, facing it (TV across from sofa) | yes |

`wall`: `near-door` (reception desk, host stand) or `far-from-door` (bed, sofa, desk). `priority` 1 essential … 3 nice.

## Solver rules (`lib/furnish/layout.ts`)

- Works on the plan (x, y) = world (x, −z); yaw matches `ops.corners`.
- Priority passes (1 → 3); anchors largest first. **Each instance is followed straight away by its own companions** (mirror →
  its styling chair → next mirror), so a later anchor can't take an earlier one's chair spot.
- **Anchors pick spots where their companions fit:** first choice = chair straight in front and nightstands on both sides;
  then companions anywhere they fit; a `beside` shortfall may fall back (a bed without nightstands is still a bed), a
  `front` shortfall may not (a mirror with no room for its chair is pointless).
- Each placed anchor adds a solid footprint and a *use zone*: in front of wall items, wide and deep enough for what sits in
  front (desk chair pulled out); around center/grid items, their seats' reach (`around` all sides, `front` ahead only) plus
  clearance. Same group (anchor + companions) may share zones; grid zones may not overlap each other → 0.9 m aisles.
- **Grids snap to a lattice** aligned with the longest wall; the phase that fits the most spots wins, and a partial grid
  grows from the middle of the free floor.
- Doors keep a 1 m deep clear patch inside the room; nothing solid goes there.
- **Walls are merged runs** of near-collinear outline edges (≤ 10°, ≤ 6 cm off line, tiny jogs absorbed): scan outlines split
  straight walls into short jogged pieces. Inward normals are tested at each wall's midpoint (L-shapes).
- Inside test: all four corners inside with clearance, and no outline vertex inside the footprint (L-shaped rooms).
- Flat items (h ≤ 0.1 m, the size clamp floor; rugs) ignore collisions but stay inside the room and aren't obstacles.
- Items too tall for the ceiling are scaled down (`underCeiling`); planned items' models never outgrow their planned
  footprint (`fitModel(…, cap)`, `Placed.planned`), so a wide model can't push into its neighbour.
- If an anchor can't be placed, its companions are dropped silently ("no room for the conference table" says it).
- **Budget** (30 pieces per request): repeats (the 7th table) must leave one slot for every other kind still to come (the
  host stand); whole groups only. Rooms get a fair share, then unused slots go back to capped rooms, current room first.
  Hitting the budget is reported as such, never as "no room".

## Edge cases → handling

| Case | Handling |
|---|---|
| No outline for the room / camera not in a room | plan endpoint not called; reply asks the user to walk into a room with a floor plan |
| Room on another floor | excluded (floor height is only known for the current floor); named room on another floor → ask to go there |
| Room too small for the plan | low-priority items dropped first; reply lists them |
| L-shaped / rotated room | vertex-in-footprint check; inward normals per edge midpoint; wall candidates per edge |
| Door on the best wall | door patch blocks it; next wall wins |
| Existing furniture placed earlier | solid obstacles; plan prompt lists them so they aren't duplicated |
| Fixtures the scan already has (sink, toilet, stove) | listed in the prompt as already present |
| Model returns `of` to an unknown key, cycles, or a dependent role without `of` | unknown/missing `of` → `wall` (beside/facing) or dropped (front/around); cycles fail the anchor-first order and drop |
| Model returns unknown room id / junk | ignored; schema-invalid output → offline templates |
| No Gemini | offline templates by use (dental/medical, restaurant/café, salon, retail, office) and room label |
| Hallway, bathroom | templates add nothing; the model is told fixtures exist and corridors stay clear |
| Repeating "furnish" | placed items are obstacles and listed to the planner, so it fills gaps instead of stacking |
| Noisy scan outline (wall in 1 m jogged pieces, 1 cm steps) | wall merging (found by test: a bed couldn't go on any wall) |
| Huge room, big grid | budget reserve keeps the host stand; grid centered; reply says it stopped at 30 |
| Once-per-place items (front desk, host stand, checkout, shampoo station) | offline templates place them once (found: 8 shampoo sinks across bedrooms); prompt says one front desk per place |

## Found while testing (renders of every scenario, then fixed)

1. Tables placed before the bar's stools took the stools' spots → companions placed right after their anchor.
2. Restaurant tables staggered instead of rows → lattice with phase search.
3. Sofa centered on its wall left no room for its armchair → companion-aware anchor placement.
4. Salon stations crowded; 4th mirror got no chair → zone sized to the chair; per-instance companions; no `front` fallback.
5. Open-office desks without room for chairs → `front` reach on the front side only.
6. "No room for 57 chairs" (dependents of dropped tables counted) → only anchors reported.
7. Noisy outlines, item budget, duplicates per room → see table above.

## Gates

- [x] G1 Solver tests (16): bedroom (bed on the far wall from the door, nightstands flank it with backs aligned), desk + tucked
  chair, sofa + TV facing, restaurant grid (no overlaps, aisles, chairs face tables), tiny room drops by priority, L-shaped
  room, rotated room, noisy outline, door patch respected, obstacles respected, ceiling scaling, rug, orphan dependents
  dropped, salon stations, item budget with reserve. Each layout checked for: inside, no overlaps, no outline corner inside a
  footprint, doorways clear.
- [x] G2 Planner tests: Gemini output validated and capped, prompt carries use/dims/doors/objects, offline templates by use.
- [x] G3 Ops: `add` with exact `pos`/`rotY` places exactly; offline parser maps "furnish this place" → `furnish` scope all.
- [x] G4 `npm test` (all but `pipeline/sample.test.ts`, which fails on `main` too) and `tsc` green.
- [x] G5 Live Gemini check through the dev server (edit + plan endpoints, 6 sample floors × uses, 2–6 s per plan, every
  layout inside its rooms with no overlaps). Found and fixed: "this place" came back as one room (code guard
  `WHOLE_PLACE`); the model's reply named things it never placed (reply now built from what was placed); receptionist chairs
  on the visitor side (`behind`); lone booths and styling chairs (prompt: seats belong to what they're used at); a center
  table drifting to a corner of a big room (tie-break toward the middle).
- [ ] G6 In the 3D tour itself (needs a real scan in the bundle; the local sample scans are synthetic).

## Not doing

Windows (not in the room graph), wall-mounted heights (TV on a stand), multi-floor furnishing, style/colour themes.
