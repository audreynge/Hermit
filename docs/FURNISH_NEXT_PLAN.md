# Plan: furnish planner, round 2

**Branch:** `furnish-planner` (builds on `docs/FURNISH_LAYOUT_PLAN.md`). **Method:** waves of parallel subagents, each in its
own git worktree with a narrow file scope and its own tests; between waves the lead reviews diffs, runs `npx vitest run` +
`npx tsc --noEmit`, re-renders the layout scenarios and live Gemini check, merges, then starts the next wave.

## Workstreams

| # | Problem | Fix | Files | Wave |
|---|---|---|---|---|
| R | Unknown what real scans provide (door positions, fixture positions, windows) and how to probe the tour's surfaces | Read-only research: pipeline queries, kit docs/schemas, Matterport SDK typings; report fields + one recommended probe method | none | 1 |
| B | No undo; re-furnish stacks | `clear` op (this room / everything) + "undo that" restores the item list before the last chat change; "refurnish" = clear room then furnish | `ops.ts`, `offline.ts`, `edit.ts`, `FurnishTour.tsx` (send/undo only) | 1 |
| E | Every furnish = 2 Gemini calls + up to 30 model searches | Cache plans by (use, prompt, room signature) in the existing KV cache; reuse one model search per item name within a request; offline `once` items fall back to a later room when they didn't fit | `plan.ts`, `FurnishTour.tsx` (lookup dedupe only) | 1 |
| F | Aisles are a fixed 0.9 m, ignoring wheelchair needs | `layoutRoom(..., { aisle, frontClear })` from the user's chair width (≥ 36 in route, 60 in turning space in front of work surfaces when a wheelchair is in use); route/client pass it | `layout.ts` (constants → options), `plan.ts`, route, `FurnishTour.tsx` (one field) | 1 |
| A | Furniture can land on built-in counters/islands (outline has no fixtures) | Per research: server-side obstacles if the data has fixture positions; else a browser probe of each planned footprint against the tour's surfaces, nudging or dropping blocked pieces, with reasons in the reply | `layout.ts` obstacles, `FurnishTour.tsx`/`scene.ts` probe | 2 |
| C | Door positions guessed; front doors without a position not kept clear | Use real opening centers wherever the bundle has them (verify join); for unknown front doors keep a clear patch at the most likely entry (wall shared with no room, nearest the entry sweep) and say it's estimated | `layout.ts` `planRooms`, maybe `pipeline/` | 2 |
| G | TV on the floor; windows | `on` place: item stands on its anchor (y offset = anchor height), rendered at that height; windows only if R finds them | `layout.ts`, `ops.ts` (pos.y), `scene.ts` | 2 |
| D | Never exercised in the real 3D tour | Extend the existing e2e furnishing test: furnish via chat on a real scan, assert items inside room outlines, no overlaps, undo works; record timings and model-load failures | `e2e/hermit.spec.ts` | 3 |

## Gates per wave
- Unit tests for every new branch; existing 122 furnish tests stay green; no new `tsc` errors.
- Layout renders re-checked by eye (scratchpad `viz/`), live Gemini check (`viz/live.mts`) has 0 outside/overlap problems.
- Each agent reports: what changed, tests run with output, anything skipped.

## Not doing
Multi-floor furnishing, style themes, auto-contacting anyone.
