# Hermit

Tell Hermit what you need. It finds the space already built for it and shows what's left to do. Product brief: `CLAUDE.md`. Technical design: `docs/DESIGN.md`.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

With no private bundle, the app serves the synthetic sample in `data/sample/` (8 made-up spaces and a recorded demo run).

## Build the private bundle (CoStar kit + Matterport)

Put `MATTERPORTAPIKEY` and `MATTERPORTAPITOKEN` in `.env`, and the kit at `~/Downloads/costar-hackathon-kit (1)` plus `~/Downloads/models_index.csv` (override with `KIT_DIR` / `MODELS_INDEX`).

```bash
npm run etl            # -> data/processed/shells.json (~2.7k candidates)
npm run matterport     # -> data/processed/roomgraphs/*.json (resumable, ~1.4k scans, ~3 min)
npx tsx --env-file=.env pipeline/thumbs.ts   # -> data/processed/thumbs/*.jpg (512px scan previews, ~48 MB)
npm run demo           # records the dental-clinic demo replay
```

`data/processed/` is gitignored. Never commit CoStar or Matterport data.

## Pages

- `/`: a short survey (city, lease/buy, use, size, budget, accessibility, requirement chips, move-in timing).
- `/search`: a chat with Hermit. It asks only for what's missing (at most 3 questions, each with tap-to-answer chips), shows its checks as they run ("Checking local zoning laws", "Measuring rooms in 3D scans"…), then lists matching spaces with a % fit, three reasons, Inside/Above/Fit evidence, a full report, Save, and an editable email to the property manager (copy or open in your mail app; never sent automatically). Follow-ups: compare layouts, refine size/location/budget, draft an email. `/search?replay=demo` replays a recorded run offline.
- `/layout`: drag-and-drop room blocks and objects (a sink in an exam room becomes a fixture requirement), with undo/redo and snap. Two-finger scroll or drag empty space to move around, pinch or Ctrl+scroll to zoom (10-400%), Fit to frame the layout. Save named layouts here (kept on this device), then pick one under "Layout" on the search form; asking the chat to change it updates the saved layout.
- `/saved`: bookmarked spaces, stored in this browser.

## Planner

When `ANTHROPIC_API_KEY` is set, Claude (`claude-opus-5-5`) runs each chat turn (structured output: reply, spec update, ready, quick replies, action) and plans the search tool calls. Without a key, a deterministic conversation and planner run the same tools (search → screen 20 → evaluate 8 → drop / escalate / rerank → report) and the trace shows `deterministic`.

**Design edits without a key (`lib/design/offline.ts`).** Chat edits to layouts and scanned spaces ("add an exam room", "turn bedroom 2 into an office") normally go through Claude. `lib/design/offline.ts` is a regex stand-in that only exists because there is no API key yet. It understands a handful of phrasings (add/remove, convert, add a fixture, merge, split) and asks the user to rephrase anything else. Once `ANTHROPIC_API_KEY` is set, decide one of these:
- **Keep it as the fallback (recommended).** `chatTurn` in `lib/chat/claude.ts` already uses it whenever the model call fails, times out or returns unusable output, and every edit still goes through the same validation. Nothing to change.
- **Remove it.** Delete `lib/design/offline.ts`. In `offline()` in `lib/chat/claude.ts`, drop the `offlineEdit` branch and reply with a short "edits need the assistant; try again or use Layout Studio" message. Then update the tests that rely on it: the offline parts of [C5] and [C7] and the `resolveRef` test in `lib/design/edit.test.ts`, plus `e2e/design-edits.spec.ts`. The e2e suite runs without a key, so it either needs a key in CI or a mocked `/api/chat`.

## Tests

```bash
npm test               # vitest unit tests
npm run e2e            # Playwright; starts the dev server if one isn't running
npx tsx scripts/try.ts "hair salon in LA about 1500 square feet"   # CLI run of the agent
```

## Known gaps and deliberate deviations from docs/DESIGN.md

- The bundle is JSON (`shells.json`), not `shells.csv`. There is no `/api/asset` route: aerial tiles load straight from Esri, and floor plans are drawn from room polygons.
- `inspect_view` checks cached scan metadata (Matterport room tags and object annotations) for named fixtures and room types. There is no vision pipeline yet.
- `search_shells` filters only city, mode, construction status, size, beds and budget. Recorded code gaps (power, sprinklers, bays) are screened next. A single gap is priced as work; a zoning conflict or two or more gaps drops the candidate.
- A TI allowance input is shown next to the work estimate and never subtracted from it.
- Vexcel: the token in `.env` returns 401 on every endpoint (it looks like an expired session token from api.vexcelgroup.com/v2). The Above tab shows Esri World Imagery and says so.
- Matterport rooms are mostly tagged `other`, and object annotations are rare. Required rooms that a scan can't identify stay *unknown*; they are not failed.
- Parking, HVAC, permit and cost figures are cited screening ranges in `rules/screening.json`, not code determinations or bids.
