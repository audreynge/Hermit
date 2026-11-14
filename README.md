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
npm run demo           # records the demo replay
npm run db:import      # loads the JSON bundle into SQLite (also happens automatically on first start)
```

`data/processed/` is gitignored. Never commit CoStar or Matterport data.

## How it works

- **One Chat tab (`/`).** Hermit asks only what it still needs (use, city, size, rooms, must-haves), at most 5 tap-to-answer questions. A single detailed message searches right away. The **+** button lets you **draw a layout** (drag rooms and objects; a sink in an exam room becomes a requirement) or **upload a floor plan** image/PDF, which Claude reads into rooms (needs the API key).
- **Results.** Each match has a % fit and three reasons, plus **View property** (Matterport 3D tour with jump-to-room, aerial, fit overlay), a full report, Save, and **Email manager** (an editable draft you copy or open in your mail app; never sent for you). Follow-ups: "compare the layouts", "make it bigger", "what permits do I need?".
- **Regulations.** Every search also researches city, county, state and federal rules for the use. With the key, a Claude sub-agent searches official sites only, and each finding must cite a URL that search actually returned. Without it, Hermit shows cited screening rules. Results are cached 30 days. LA reports also cross-check CoStar zoning against the SCAG parcel layer.
- **Storage.** SQLite at `data/processed/hermit.db` (or `data/sample/hermit.db`) holds properties, room graphs, runs, conversations, saved spaces, designs and the regulation cache. It is filled from the JSON bundle on first start; `npm run db:import` refreshes it. Conversations live at `/?c=<id>`: reload or share the link (others can read it and start their own copy). Saved spaces are per browser.
- `/saved` lists bookmarked spaces. `/?replay=demo` replays a recorded run offline. `/search` and `/layout` redirect into the chat.

## Planner

When `ANTHROPIC_API_KEY` is set, Claude (`claude-opus-5-5`) runs each chat turn (structured output: reply, spec update, ready, quick replies, action) and plans the search tool calls. Without a key, a deterministic conversation and planner run the same tools (search → screen 20 → evaluate 8 → drop / escalate / rerank → report) and the trace shows `deterministic`.

## Tests

```bash
npm test               # vitest unit tests
npm run e2e            # Playwright; starts the dev server if one isn't running
npx tsx scripts/try.ts "hair salon in LA about 1500 square feet"   # CLI run of the agent
npm run explore -- --base http://localhost:3000   # 25 scripted conversations against the running app, checks invariants
```

## Known gaps and deliberate deviations from docs/DESIGN.md

- The bundle is JSON (`shells.json`), not `shells.csv`. There is no `/api/asset` route: aerial tiles load straight from Esri, and floor plans are drawn from room polygons.
- `inspect_view` checks cached scan metadata (Matterport room tags and object annotations) for named fixtures and room types. There is no vision pipeline yet.
- `search_shells` filters only city, mode, construction status, size, beds and budget. Recorded code gaps (power, sprinklers, bays) are screened next. A single gap is priced as work; a zoning conflict or two or more gaps drops the candidate.
- A TI allowance input is shown next to the work estimate and never subtracted from it.
- Vexcel: not connected yet. The `.env` token returns 401 everywhere; add a Vexcel login (or fresh token) and the viewer's aerial and oblique views can switch over. Until then the aerial view is Esri World Imagery and says so.
- Matterport rooms are mostly tagged `other`, and object annotations are rare. Required rooms that a scan can't identify stay *unknown*; they are not failed.
- Parking, HVAC, permit and cost figures are cited screening ranges in `rules/screening.json`, not code determinations or bids.
