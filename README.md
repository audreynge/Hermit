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
npm run demo           # records the dental-clinic demo replay
```

`data/processed/` is gitignored. Never commit CoStar or Matterport data.

## Planner

When `ANTHROPIC_API_KEY` is set, Claude (`claude-opus-5-5`) parses free text into a spec and plans the tool calls. Without a key, a deterministic planner runs the same tools (search → screen 20 → evaluate 8 → drop / escalate / rerank → report) and the trace shows `deterministic`.

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
