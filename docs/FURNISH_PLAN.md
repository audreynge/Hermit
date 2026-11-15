# Plan: furnish the 3D tour with natural language

**Branch:** `feat/furnish-tour`. **Goal:** while touring a Matterport scan, the user types or says "put a stove here" and a 3D stove appears where they pointed. They can click to select it, click the floor to move it, rotate it, recolor it, swap the model or remove it. Furniture suggestions come from the user's intended use (a ramen shop gets a commercial range and bar stools), not from a fixed per-mode list.

**Core rule (same as `DESIGN_EDITS_PLAN.md`):** Gemini picks typed ops and suggests items; code computes every position, size and color change. Nothing here is evidence about the property: placed furniture is a visualization and is labeled as such.

**Done means:** every gate below is green, then `npm test`, `npm run typecheck` and `npm run e2e` pass on two loop runs in a row.

## Constraints

- **Gemini free tier only** (existing `geminiClient()` / `geminiJson()`). Every Gemini path has a deterministic fallback.
- **Poly Pizza free plan: 3,000 calls/month.** Every search is cached in the DB (`regulation_findings` key-value cache, key `polypizza:<query>`, 30 days). Tests never call the live API (mocked `fetch` + recorded fixture). Live calls during development are logged and kept under **100**.
- GLBs load straight from `static.poly.pizza` in the browser (verified: `access-control-allow-origin: *`), so they are not proxied.
- Matterport Scene API works in the **Bundle** only → `@matterport/webcomponent@0.1.47` + `three@^0.184` (its peer dependency). The browser gets the public SDK key from `/api/tour-key` at runtime.

## Parts and gates

### P0. Spike: objects in the tour
Swap nothing yet; a throwaway dev page loads a kit scan in `<matterport-viewer>` with `MATTERPORTSDKKEY`.
- [x] G0.1 The tour loads and `sdk.Scene` exists.
- [x] G0.2 A Poly Pizza GLB (cached fixture URL) renders at a fixed point, lit, at a sane size.
- [x] G0.3 Clicking the floor yields a world point (`Pointer.intersection` or equivalent) and the object can be moved there.
- [x] G0.4 Recoloring the object's materials at runtime works.
- [x] G0.5 The clicked point maps to the right `RoomGraph` room (polygons are meters on the floor plane), checked in two rooms.
Record the exact APIs and axis mapping found here in the log; later parts depend on them.

### P1. Pure core (`lib/furnish/`)
Types, ops and placement with no I/O.
- `FurnishItem` (name, terms[], size m, category), `Placed` (id, item, model, position, rotation, color, material).
- `FurnishOp`: `add` (item, at: `point` | `front` | `center` | `wall`), `move`, `rotate`, `remove`, `recolor`, `swap`.
- `applyFurnishOps(state, ops, ctx)` → `{ value, applied, rejected[] }`; Zod-validated; max 10 ops.
- [x] G1.1 Unit tests for every op, including rejects (unknown id, bad color, too many ops), each with a reason.
- [x] G1.2 `add` with any anchor ends inside the current room polygon (point-in-polygon test), floor-level.
- [x] G1.3 Sizes from any source are clamped to 0.1–6 m; a model is scaled by its bounding box to the item's size.
- [x] G1.4 `matchesTerms(title, terms)` rejects "Hotel" for host stand and accepts "Kitchen Stove" for stove.
- [x] G1.5 Offline parser handles add/remove/move-here/rotate/recolor for ≥ 12 test phrases.

### P2. Model search (`/api/furniture/search`)
- [x] G2.1 Cache hit: the same query twice → one upstream fetch (mocked).
- [x] G2.2 Concurrent identical queries share one upstream request.
- [x] G2.3 Results filtered by `matchesTerms`; none left → `{ fallback: "box" }`.
- [x] G2.4 No key / upstream error / 429 → box fallback, never a 500.
- [x] G2.5 Input validated (query length, characters); each result carries licence + attribution text.

### P3. Suggestions (`/api/furniture/suggest`)
Input: the user's intended use in their words + room label + room area. Output: ≤ 12 items with search terms and typical size.
- [x] G3.1 Output Zod-validated; sizes clamped; cached by (use, room label).
- [x] G3.2 Offline fallback (from `FURNITURE` + `rules/uses.json` packs) is non-empty for every room label.
- [x] G3.3 One live check each (≤ 4 Gemini calls): restaurant kitchen, restaurant dining, salon, home living room. Items are plausible for the use (judged and noted in the log).

### P4. Chat → ops (`/api/furniture/edit`)
- [x] G4.1 Gemini gets placed items (ids, names) + suggestions; ops referencing unknown ids are rejected, not guessed.
- [x] G4.2 Same 12 phrases from G1.5 through Gemini: ≥ 10/12 produce the expected ops (one live run).
- [x] G4.3 Gemini error / quota → offline parser, and the reply says which path ran.

### P5. Tour UI
`PropertyViewer` 3D tab uses the SDK viewer with a side panel.
- [x] G5.1 Panel: suggestion chips for the current room, chat input (+ mic via `/api/stt`), placed-item list, color/material/model controls, credits.
- [x] G5.2 Click item → selected (outlined in list); click floor → moves there; rotate ±45°; remove.
- [x] G5.3 If the SDK fails or times out, the plain iframe tour still shows (offline-demo rule).
- [x] G5.4 Keyboard: every control reachable and labeled; axe finds no violations in the panel.
- [x] G5.5 Playwright e2e with mocked APIs: add a stove by chat → it's in the list; recolor; remove.
- [x] G5.6 Manual check on a real scan with a screenshot: stove placed in the kitchen, moved, recolored.

### P6. Persistence
- [x] G6.1 Placed items saved per `sid` in localStorage (`lib/client` `load`/`save`); reload restores them.

## Log
Decisions and corrections during the loop go here, newest last.

**P0 (2026-11-14), spike `app/spike-furnish` on a real home scan, headless Chrome (SwiftShader):**
- [P0.1] The SDK key works on kit scans; `Scene` exists. Bundle assets are copied to `public/mp` by `postinstall` (gitignored, 38 MB); `<matterport-viewer asset-base="mp">`.
- [P0.2] The package `exports` hides its types → `lib/viewer/webcomponent.d.ts` loads them by path. Key reaches the client via `next.config.ts` `env.NEXT_PUBLIC_MATTERPORT_SDK_KEY`.
- [P0.3] Poly Pizza GLBs are already in meters (stove 0.45×0.67×0.55). Still scale to the item's typical size: that stove is shorter than a real one (~0.9 m).
- [P0.4] Placing: `Renderer.getWorldPositionData({x,y} px, floorY)` intersects the floor plane at that height. Without the height it hits the first surface (a countertop at 0.81 m in the kitchen). Floor height = `Sweep.current.puckPosition.y`.
- [P0.5] Clicks: the viewer draws in a shadow DOM (no iframe), so `pointerdown`/`pointerup` capture listeners on `<matterport-viewer>` see every click. `mp.input` emitted no events at all; not used. A model click comes from `obj.spyOnEvent({ path: obj.addEventPath(gltfComponent, "INTERACTION.CLICK") })`, emitted from Matterport's render loop, so pointerup waits 3 animation frames before deciding select vs move. Presses that move > 5 px are look-around drags, ignored. The camera didn't move on the move click.
- [P0.6] Recolor: clone each mesh material, set `map = null` and `color`. Keeping the texture map multiplies it (red came out near-black).
- [P0.7] Room mapping: SDK room ids == RoomGraph room ids (`Sweep.current.roomInfo.id`). Graph polygon `(x, y)` == world `(x, −z)`; checked with the camera in living, kitchen and a bedroom. Use the graph's label (SDK said "Other" for the living room).
- [P0.8] Lighting: `mp.lights` alone looks dim; add an ambient light.

**P1–P4 (2026-11-14):**
- [P1.1] `add` has `count`: the shared `parseOps` drops identical ops, so "add two stools" can't be two identical adds (same fix as the design edits' [L11]).
- [P1.2] Placement fixes in code: wall items back onto the nearest edge of the room polygon, inset by half their depth, facing in; any point outside the room, or closer than half the footprint to a wall, is pulled inside (`keepInside`). Front items face the camera.
- [P2.1] Search returns `models: []` instead of `{ fallback: "box" }`: an empty list already means "draw a box".
- [P2.2] Raw Poly Pizza results are cached per normalized query in `regulation_findings` (key `polypizza:<q>`, 30 days), misses too; errors are not cached. Search terms made only of category words ("furniture", "living room furniture") are skipped: Gemini emits them and they match unrelated titles.
- [P3.1] Suggestion chips show names only; a model search runs only when an item is actually added, so a new (use, room) costs 1 Gemini call and 0 Poly Pizza calls.
- [P3.2] G3.3 live (4 calls): ramen kitchen → commercial range, noodle cooker, deep fryer, soup kettle, prep table…; ramen dining (scan label "living") → four-top/two-top tables, dining chairs, POS terminal; salon → styling chair, salon station, backwash unit; family home living → sofa, coffee table, TV stand. All plausible.
- [P4.1] Gemini sends `null` for unset optional fields; the flat schema uses `.nullish()` and `unflatten` (made generic) drops them. Adds that name a suggestion get its terms and size in code.
- [P4.2] G4.2 live: 16/16 phrases through Gemini. Phrases live in `lib/furnish/phrases.fixture.ts`, shared with the offline parser test (16/16 offline too).
- Pre-existing, not from this branch: 4 failures in `lib/design/edit.test.ts` (same on a clean tree).
- Poly Pizza live calls so far: ~11.

**P5–P6 (2026-11-14):**
- [P5.1] The SDK key comes from `GET /api/tour-key` (reads `MATTERPORTSDKKEY` at runtime). `next.config` `env` inlining was dropped: a dev-server worker restart lost the value and the tour silently fell back.
- [P5.2] `mp.input`'s `userNavigationEnabled: false` did not stop the tour from walking to a floor click. While moving an item, capture-phase listeners on `<matterport-viewer>` stop the pointer/mouse/click events before Matterport sees them, and the floor point comes from `Renderer.getWorldPositionData(..., floorY)`. Checked: camera position identical before and after the move click.
- [P5.3] Material presets keep metalness ≤ 0.35: no environment map in the tour, so metallic surfaces rendered near-black ("stainless steel" looked brown).
- [P5.4] A fake/unknown model never raises `mpViewerError`; it just never plays. Fallback = 25 s timeout, plus an "Open the basic tour instead" button on the loading overlay.
- [P5.5] Suggestions load even when the current sweep isn't in a known room (room = "space").
- [P5.6] e2e `furnishing the 3D tour` runs on the bundled synthetic demo replay with its scan swapped for Matterport's public demo model `SxQL3iGyoDo`; all three furniture APIs are mocked, so it spends no Gemini or Poly Pizza calls and ships no private data. Passed 3 runs in a row. Desktop Playwright project gets SwiftShader flags for WebGL. axe excludes `matterport-viewer` (an inert meta viewport inside its shadow DOM).
- [P5.7] The two iframe tour e2e tests stub `/api/tour-key` → `{ key: null }` to keep testing the iframe. They (and the wheelchair test) currently fail earlier, in live-Gemini chat wording (`chatToResults` expects "Perfect, I have what I need"); not caused by this branch.
- [P5.8] G5.6 manual: a replayed restaurant search (real scan): restaurant suggestions shown, "+ commercial range" placed a Poly Pizza model, "make it stainless steel" applied via Gemini, Move + floor click moved it, items restored after reopening.
- Known noise: closing the viewer logs two uncaught errors from the Matterport SDK's own teardown ("IToolsModule module unloaded"). Harmless.
- Pre-existing failures, same on a clean tree: 4 in `lib/design/edit.test.ts`, 1 in `pipeline/sample.test.ts`.
- Poly Pizza live calls during development: ~15 of 3,000.

---

# Round 2: drag and drop, Sketchfab, visible loading states

**Feedback (2026-11-14):** (1) moving is clunky: clicking moves *the user* instead of the item; wants drag and drop. (2) Try Sketchfab models. (3) Some models never appear, so the item looks missing with no explanation.

**Causes found in the current code:**
- Item clicks reach Matterport. We only learn an item was hit *after* Matterport has handled the click (its CLICK event fires from the render loop), so the same click also walks the tour toward that spot. Only clicks in "Move" mode are blocked.
- `scene.ts` draws nothing while a model is being searched for or downloading, and nothing forever if the GLB fails to load (`objectRoot` never arrives; the 500 ms retry loop just keeps waiting). The panel still lists the item, so it looks broken.

## Q1. Drag and drop (replaces click-to-move)
Our own hit test at `pointerdown`, before Matterport sees the event:
- A small registered scene component (`hermit.picker`) exposes `context.camera` (documented, read-only). On `pointerdown` (capture phase on `<matterport-viewer>`), raycast with three.js against our item meshes only.
- **Hit an item:** stop the event (Matterport never sees it: no look-around, no walking), select the item and start dragging. On each `pointermove`, intersect the mouse ray with the floor plane `y = floorY` (pure math, synchronous, so it tracks the cursor every frame) and move the node live. On `pointerup`, commit one `move` op (room clamping and saving happen as now). A press without movement is just a select.
- **Missed:** do nothing, so the tour behaves normally (drag to look, click to walk).
- Rotate while dragging: `R` key / scroll wheel ±15°. Keyboard users keep the panel buttons (to wall, to center, rotate) and gain arrow-key nudges (10 cm) on the selected item.
- Remove the "Move" mode, its banner and the swallow-all-clicks code.

Gates:
- [x] R1.1 Spike: `context.camera` tracks the live view (a raycast at the screen center hits a test box placed straight ahead).
- [x] R1.2 Pressing on an item and dragging moves it smoothly; the camera position and sweep are unchanged afterwards (checked by script).
- [x] R1.3 Clicking empty floor still walks the tour; dragging empty space still looks around.
- [x] R1.4 Unit tests for the pure parts: ray → floor-plane point, drag commit stays inside the room.
- [x] R1.5 e2e: select by clicking the item in the 3D view, drag it, check the saved position changed.

## Q2. Sketchfab as a second model source
Verified 2026-11-14: search needs no key and returns `archives.glb.size`, `faceCount`, licence and thumbnails; `GET /v3/models/{uid}/download` with `Authorization: Token …` returns a signed GLB URL that expires in **300 s**; it allows any origin (`access-control-allow-origin: *`). The search's `archives_max_size` filter is ignored, so size is filtered in code.
- `searchModels` queries Poly Pizza and Sketchfab (both cached 30 days per query, as now). Sketchfab results are kept only if: GLB ≤ 8 MB, faces ≤ 60k, not animated, licence CC0 / CC BY / CC BY-SA (no NonCommercial; no NoDerivatives, since recoloring modifies the model), and the title matches the terms (`matchesTerms`).
- Order: Sketchfab first when it has a match (more realistic), Poly Pizza next; "Other models" shows both, labeled by source.
- Stable model URL: `/api/furniture/model/sketchfab/<uid>` asks Sketchfab for a fresh download link (cached ~4 min) and redirects to it. Saved layouts keep the stable URL, so they still load next week.
- Attribution text built from the Sketchfab author and licence, shown in credits like Poly Pizza's.

Gates:
- [x] R2.1 Unit tests with recorded response shapes: size/licence/animation filters, ordering, caching (second identical query makes no request), missing key → Poly Pizza only.
- [x] R2.2 Redirect route: 302 to a signed URL; unknown or bad uid → 404; download URL cached so a burst of loads makes one Sketchfab call.
- [x] R2.3 Live, ≤ 10 Sketchfab searches + ≤ 5 downloads total: a stove, a sofa and a restaurant item load in the tour from Sketchfab.

## Q3. Never blank: visible states and automatic fallbacks
- Every placed item is visible at once as a **translucent box at its size** with a spinner-style pulse while the model is searched for and downloaded. The real model replaces it when ready.
- Load watchdog: if the GLB hasn't produced a model within **12 s**, or loads with an empty or invalid size (zero or infinite bounding box), try the next candidate model automatically (up to 3), then settle on the labeled box.
- Panel list shows each item's state with its thumbnail: "Finding a model…", "Loading…", "Showing a box: no 3D model found", "Showing a box: the model failed to load" + a "Try another model" button. Announced in a polite live region.
- Server side: skip models whose GLB is larger than 8 MB (Sketchfab gives the size; Poly Pizza is small).

Gates:
- [x] R3.1 e2e with a mocked search pointing at a URL that returns 404 → the item shows "the model failed to load", a box is visible in the scene (node present), and no endless retry (request count stays ≤ 3).
- [x] R3.2 Unit test for the candidate fallback order.
- [x] R3.3 Manual: 5 restaurant suggestions placed in a real scan; every one is visible (model or box) within 15 s, each with a clear state in the panel.

## Q4. UI/UX: no scrolling, the tour is the stage
**Feedback:** the popup is small and the side panel has to be scrolled to reach furniture and controls.
Layout (decision: overlays on a full-size tour instead of a side column):
- The 3D tab opens the popup at nearly full screen (`.modal:has(.furnish)`: width/height ≈ viewport minus 24 px). The tour fills it; the address line and the old side column go away. Room jumps become one compact "Room" dropdown in the top bar.
- **Bottom tray** (overlaid on the tour, ~150 px tall): tabs **Suggested · Placed (n) · Search**. Each tab is a single horizontal row of cards (thumbnail or icon, name, state), scrolled sideways with buttons/arrow keys, never vertically. Search = type a word ("piano"), see model cards from both sources.
- **Place by dragging a card** from the tray onto the floor (drops where released; same floor-plane math as Q1). Clicking a card still places it in front of you.
- **Chat bar** on the tray's top edge: one line with mic and send. The last reply shows as a small toast above it for a few seconds, plus a "history" popover.
- **Selected item → floating toolbar** pinned top-center of the tour: name, rotate ⟲ ⟳, color (opens a small swatch popover), material (popover), "Other models" (opens the tray's Search tab prefilled), remove. Nothing permanently expanded.
- Tray can collapse to just the chat bar (button and `T` key) to see the whole room.
- Status (loading/box/failed from Q3) shows on the card and as a badge on the toolbar.
- Mobile (< 760 px): tray becomes a bottom sheet over the tour; same tabs.

Gates:
- [x] R4.1 At 1280×800 and 1440×900, with 10 placed items and 10 suggestions, the popup and the panel never scroll vertically (`scrollHeight <= clientHeight` checked by script); every card is reachable by sideways scroll or arrow keys.
- [x] R4.2 Drag a tray card into the tour → item placed at the drop point (e2e).
- [x] R4.3 Keyboard: Tab reaches the tray tabs, cards, chat, toolbar; Esc closes popovers before the popup; axe clean (viewer excluded).
- [x] R4.4 Screenshots at desktop and mobile sizes reviewed: the tour stays the main thing on screen (≥ 70% of the popup area when the tray is open).

## Order and stopping rule
R1 spike first (it decides whether drag is possible this way; if `context.camera` doesn't work, use `Conversion.worldToScreen` on item bounding boxes for the hit test instead). Then Q3 (biggest confusion, small change), then Q4 layout (it reshapes the component Q1 and Q2 plug into), then Q1 implementation, then Q2. Default for the open question: Sketchfab first when it has a match, Poly Pizza as fallback. Each part's gates must pass before the next; then `npm test`, typecheck and the furnishing e2e twice in a row.

**Round 2 log (2026-11-14):**
- [R.1] `context.camera` from a registered component (`hermit.camera`) tracks the live view; the scene exposes `ray`, `floorAt` and `screenOf` from it.
- [R.2] Hit-testing loaded meshes (and their Box3) was unreliable: thin pieces (table legs) and stale model matrices made presses miss. Picking now uses `hitItem` (pure, unit-tested): the ray against each item's intended box (pos, size, rotY). Independent of model load state.
- [R.3] Root cause of many "blank" models: the fit measured the model's Box3 in world space before its matrices updated, so the offset included the item's world position (or missed nested Sketchfab scale nodes) and the model rendered far away or at the wrong size. Now `updateWorldMatrix(true, true)` and the box is taken in the parent's frame.
- [R.4] Second cause of "blank": "in front of me" (camera + 1.65 m) landed under the tray or behind walls, which the tour hides. Now: first point (scanning up from the tray, center then sides) where Matterport's own surface (`getWorldPositionData` without a height) is floor; none → the tray collapses and the old default is used.
- [R.5] The selected item draws through walls (depthTest off, 85% opacity), so a just-placed or dragged item never seems to vanish. New items are auto-selected.
- [R.6] New items avoid existing ones (`freeSpot`: sideways, alternating, then rows behind/in front). Without it, ten "front" items stacked on one spot.
- [R.7] Sketchfab PBR models are often fully metallic → black without an environment map. Loaded materials get metalness ≤ 0.35 (same reason as the presets, [P5.3]).
- [R.8] Drag: capture-phase pointer listeners on `<matterport-viewer>`; a press on an item is stopped before Matterport (no look-around, no walking), the node follows the floor-plane point each move (clamped to the room), one `move` (+ `rotate` from the wheel) op on release. Checked by script and e2e: camera identical before/after.
- [R.9] Sketchfab: search is public; the `archives_max_size` filter is ignored, so GLB ≤ 8 MB / faces ≤ 60k / no animation / CC0, BY, BY-SA are filtered in code. Download links (300 s) are cached 4 min per instance behind `/api/furniture/model/sketchfab/<uid>` (302). Live use this round: 4 searches, ~4 downloads. Real loads seen: four-top table, commercial range.
- [R.10] UI: popup ~full screen when the 3D tab is open (`.modal:has(.furnish)`); tour 80% of the popup at 1280×800; tray (chat, tabs, one sideways strip, room picker, credits) ~190 px; floating toolbar with popovers; toast for replies. No vertical scroll at 1280×800/1440×900 with 11 items (e2e). Phone 390×844 reviewed.
- [R.11] e2e `furnishing the 3D tour` covers chat add, card drag-and-drop, no-scroll, sideways overflow, 3D drag with a still camera, broken model → next → box with no further retries, toolbar color, Esc closing the popover before the dialog, axe. Passed 3 times in a row. Mocks all furniture APIs; no Gemini, Poly Pizza or Sketchfab calls.

---

# Round 3: real-world scale and placement that respects the room

**Feedback (2026-11-14):** a trash can came out far too small, other items far too big; a wheelchair ended up inside a wall and couldn't be moved into the room. Use Matterport's measurements to tie model size to the scan.

## What I measured before planning
- **Model files use arbitrary units.** Sketchfab "Trash Can" is 369 × 301 × 358 units (centimeters) with its base 1.4 units above origin; Sketchfab "Wheelchair" is normalized into a 2-unit cube centered on origin. (Read from the GLB accessor bounds, no rendering.)
- **Fitting itself now works** (after [R.3]): placed in the restaurant scan, both models render exactly inside their intended box, bottom on the floor, centered on their spot (`bounds(id)` debug helper).
- **The intended sizes are guesses.** Neither "trash can" nor "wheelchair" is in the ~60-name typical-size table, so both got the 0.6 × 0.6 × 0.8 m default. Chat adds include a size only "when unusual"; Search-tab adds include none.
- **Fit-inside-the-box with unknown orientation distorts things.** The wheelchair rendered 0.59 wide × 0.40 deep × 0.58 tall: its long axis came out sideways, and the footprint cap kept it ~0.3 m shorter than a real one (~0.65 × 1.05 × 0.9 m).
- **Code uses the intended box, not the rendered one,** for picking, room clamping and spacing, so what you see and what you can grab can differ.
- **Wall clamping is weak.** It only uses the room the *camera* stands in, keeps only the smaller half-side away from walls, ignores rotation, and does nothing when that room has no polygon (e.g. "other"/outdoor regions, unaligned sweeps). That is how an item can end up inside a wall.
- **Matterport gives us more than we use:** room polygons and ceiling heights (RoomGraph `heightFt`, from the Model API's room dimensions), `Room.current` bounds, `Measurements.add` (draw native measurement lines with labels), `Measurements.toggleMode` + `data` (read measurements the user draws, with lengths), and `getWorldPositionData` (the real surface under any screen point).

## S1. Know each model's true dimensions before loading it
- When search results come back, the server reads each top candidate's **GLB header only** (an HTTP range request for the first ~256 KB, where the glTF JSON lives) and computes its bounding box from accessor min/max and node transforms. No full download, no rendering. Cached forever per model id.
- Each result then carries `dims` (w, d, h in model units), its base offset and which horizontal axis is longer.
- Pick the candidate whose **proportions** best match the item's real-world size (a 0.4 × 0.4 × 0.65 trash can should not use a 3 m wide "trash area" scene). Drop candidates whose bounds are clearly a scene (flat ground plane, >10:1 proportions).
- Gates: unit tests with synthetic GLB headers (units, nested transforms, offset base, ground plane); live: trash can and wheelchair candidates get dims matching the measurements above; ≤ 3 Sketchfab download calls per new search, cached.

## S2. Real-world target sizes for any item
One `sizeFor(name)` used by every add path (chat, suggestion card, search card, offline):
1. A larger typical-size table (+ ~50 common items: trash can, wheelchair, recycling bin, coat rack, high chair, booth, bar cart, mirror, filing cabinet…), all in meters.
2. Otherwise Gemini "typical width, depth, height in meters" for that name, one call per new name, cached 30 days; chat and suggestion prompts always return sizes.
3. Otherwise the default, flagged "approximate size" in the toolbar.
- Sanity limits from the scan: height ≤ the room's ceiling height − 5 cm (RoomGraph `heightFt`, else `Room.current` size); footprint ≤ the room's size.
- Gates: unit tests for lookup order, caching and ceiling cap; trash can → ~0.4 × 0.4 × 0.65 m, wheelchair → ~0.65 × 1.05 × 0.9 m.

## S3. Height-first fitting with the right orientation
- Scale so the model's **height** equals the target height (the most reliable dimension). Then check the footprint: if it's off by more than ~40% from the target, the model is probably the wrong kind of thing (or includes extras), so try the next candidate; otherwise keep it.
- Turn the model inside its node so its long horizontal side lines up with the item's width (the table convention is width ≥ depth). Front/back facing stays the user's call (rotate).
- Store the **rendered size** on the item (`fitted`), separate from the target, and use it for picking, wall clamping, spacing and the dimension labels.
- Gates: in the real scan, 12 common items render within 10% of target height and within 20% on footprint (where a matching model exists); the wheelchair's long side runs front-to-back; picking hits the visible model.

## S4. Placement that stays out of walls
- Clamp to the room that **contains the target point** (any room on the current floor), not just the camera's room, using the **rotated footprint**: all four corners must sit inside the polygon with 3 cm clearance; otherwise push inward along the nearest wall's normal.
- Where there's no polygon: probe the real surface at the footprint's corners (project each to screen, `getWorldPositionData`); a corner whose surface isn't floor means a wall or fixture is there, so nudge away from it.
- Drag uses the same rule, so an item can be dragged through a doorway into the next room but never into a wall.
- **"Bring it here"** on the toolbar and on Placed cards: moves the item to visible floor in front of you, for anything stuck or lost.
- Gates: unit tests for rotated-footprint clamping (concave rooms, corners, 90° turns); live: a wheelchair placed with its center 10 cm from a wall ends fully inside and can be dragged; e2e: an item placed in a wall can be recovered with "Bring it here".

## S5. Use Matterport's measurements
- **Live dimensions:** while an item is selected, draw native Matterport measurement lines for its width, depth and height (labels in feet and inches), plus the gap to the nearest wall from the room polygon. Removed on deselect.
- **Size from a measurement:** a toolbar button opens Matterport's measure mode; the user measures a gap or a wall; the selected item takes that length (horizontal → width, vertical → height; proportions kept), lines up along the measured line, centers on it and backs onto the wall side.
- **Exact sizes by chat:** a new `resize {id, w?, d?, h?, scale?}` op with units (in, ft, cm, m): "make it 30 inches wide", "set the height to 3 ft", "make it 20% bigger". Supported by the offline parser and the Gemini prompt.
- Gates: unit tests for unit parsing and resize; live: measure a counter gap, the selected stove matches it within 2 cm; dimension lines appear and disappear with selection; e2e with measurements mocked.

## S6. Verification harness (first, to get a baseline)
- A dev script that places a fixed list of 12 common items (trash can, wheelchair, sofa, bed, dining table, chair, stove, fridge, desk, plant, bookshelf, toilet) in two real scans and records: target size, chosen model, rendered size, rotation, fully inside the room (yes/no), pickable at its visible center (yes/no). Run before and after each part; the numbers go in the log.

**Decisions (2026-11-14):** dimension labels in feet and inches only (no meters); sizing from a measurement scales proportionally.

## Order
S6 baseline → S2 → S1 + S3 → S4 → S5 (resize by chat, then measurement lines, then size-from-measurement). Each part's gates pass before the next; then `npm test`, typecheck and the furnishing e2e twice in a row.

**Round 3 log (2026-11-14):**
- [S.0] Baseline (a real restaurant scan, 12 items via the Search tab): height within 10% 5/12 (sofa and bookshelf rendered 0.17 m: models lying on their side), fully inside a room 9/12, pickable 4/12. Harness: dev-only `bounds(id)` + `screenOf` on `window.__furnish`, room polygons exported from the run.
- [S.1] UX trap found by the harness: with an item selected, a Search card replaced that item's model instead of adding one. Replacing is now an explicit mode ("Replacing the X ✕"), entered only from "Other models".
- [S.2] `sizeFor`: typical table grown to 136 items (trash can, wheelchair…), else Gemini typical size per name (cached 30 d), else the default flagged "~"; ceiling cap from RoomGraph `heightFt`. Search adds and chat adds now always get a real size.
- [S.3] `glbBounds` reads model bounds from the GLB header (range request, first 256 KB); `rankModels` orders candidates by `fitModel` error (footprint vs target after height-first scaling), clear misfits last.
- [S.4] `fitModel` tries Y/Z/X as up × two horizontal turns, scales to the target height, keeps the best footprint match (authored orientation preferred unless clearly worse). Items store `fitted` (rendered size), used by picking (`hitItem`), wall clamping and spacing.
- [S.5] Loader bug: Matterport's gltf loader applies `localPosition` inside the scaled frame, so off-center models rendered up to 1.4 m away from their spot (chair) or sank into the floor (plant). The transform is now set directly on the loaded object (position·rotation·scale). Max offset after: 4 cm.
- [S.6] Concurrency: 12 heavy downloads at once made some exceed the load timeout. Models load 3 at a time on their own scene object; the 12 s timeout starts with each download.
- [S.7] Sketchfab download API returned 429 (59 times) once candidates were being measured too: measuring shared the rate limit with actual loads. Now at most 2 Sketchfab candidates are measured per search (all Poly Pizza ones), bounds cached forever per model, a 60 s backoff after a 429, and unmeasured models are fitted in the browser after loading (same `fitModel`; rendered size reported back). Next run: 0 new 429s.
- [S.8] Walls: rotated-footprint clamping (`keepRectInside`, all 4 corners, 3 cm clearance) in whichever room contains the item (`roomAt`), for add, move, rotate, resize, drag and spacing. Live: a wheelchair dragged hard into a wall stayed fully inside and could be dragged back. "Bring it here" on the toolbar.
- [S.9] Matterport's measurement lines (`Measurements.add`) were stored but not drawn outside its measure mode, and its measure mode didn't take clicks in testing. Replaced by our own: an SVG overlay (W/D/H + gap to wall, feet and inches, re-projected every frame) and a ruler tool whose two clicks snap to the scanned surface (`getWorldPositionData`); the item then resizes proportionally, turns along the line facing the camera, and centers on it. Live: a 3′ 1″ measurement set the stove's width to 0.93 m with proportions kept.
- [S.10] Chat resize: `resize {id, w|d|h|scale}`, always proportional; Gemini returns value + unit and code converts (live: "make it 30 inches wide" → w 0.762; "20% bigger" → scale 1.2); offline parser handles inches/feet/feet-and-inches/cm/m, percentages, twice/half.
- [S.11] Final harness: restaurant and clinic scans, 12/12 heights within 10% (all exact), 12/12 inside a room, 12/12 models loaded, max model offset 4 cm, no missed picks except clicks landing on an overlapping item. Footprint within 20%: 9/12 and 5–6/12; the rest are models whose real proportions differ (wide bins, spreading plants, deep bookshelves).
- [S.12] Unit tests 88 in `lib/furnish`; e2e covers the dimension overlay, measuring (camera unchanged), proportional result, and "Bring it here"; passed 4 runs. Same 5 pre-existing unrelated failures.
