# Hermit

Tell Hermit what you need. It finds the space already built for it and shows what's left to do. Product brief: `CLAUDE.md`. Technical design: `docs/DESIGN.md`. Pitch: `docs/PITCH.md`. Devpost text: `docs/DEVPOST.md`.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

With no private bundle and no keys, the app serves the synthetic sample in `data/sample/` (made-up spaces and a recorded run).

### Environment

Put these in `.env` (never commit it). All are optional for the sample bundle.

| Variable | Used for |
|---|---|
| `MATTERPORTAPIKEY`, `MATTERPORTAPITOKEN` | Matterport GraphQL (room graphs, panoramas, thumbnails) |
| `MATTERPORTSDKKEY` | Showcase 3D tour in the browser |
| `VEXCELAPIKEY` | Vexcel orthophotos |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Planner, photo checks and aerial counts |
| `ANTHROPIC_API_KEY` | Optional: Claude runs the planner instead of Gemini |
| `CENSUS_API_KEY` | Census ACS neighborhood data |
| `BEST_TIME_KEY` | Busiest-hours proxy |
| `DATABASE_URL` | Supabase Postgres catalog |
| `SECRET_KEY` | Server-side secret |
| `ELEVENLABS_API_KEY` | Dictation and "Read replies aloud" |

## Routes

- `/` home
- `/studio` Find a space: a short interview with the Layout Studio, then Matching Spaces and "How Hermit decided"
- `/shell/[id]?run=<run>` Shell Report, with tabs Overview, Inside & furnish, Neighborhood, Lease coach and Talk to your broker
- `/packet/[run]/[shell]` printable packet, `/saved` saved spaces, `/messages` drafted messages (never sent)
- `/studio?replay=<id>` replays a recorded run with no network (the sample bundle ships `demo`)
- `/search`, `/chat`, `/address` and `/layout` redirect to `/studio`

## Build the private bundle

Needs the CoStar kit at `~/Downloads/costar-hackathon-kit (1)` and `~/Downloads/models_index.csv` (override with `KIT_DIR` and `MODELS_INDEX`). Outputs go to `data/processed/`, which is gitignored.

```bash
npm run etl                                           # CoStar kit + index -> shells.json
npx tsx pipeline/index.ts                             # alternative: all 14,944 index rows, no CoStar fields
npm run matterport                                    # room graphs (resumable)
npx tsx --env-file=.env pipeline/thumbs.ts            # 512px scan previews
npx tsx --env-file=.env pipeline/neighborhood.ts      # OSM, traffic counts, Census per site
npx tsx --env-file=.env pipeline/geocode.ts           # coordinates for scans with only an address
npx tsx pipeline/workers.ts                           # daytime-population proxy (Census LODES)
npx tsx --env-file=.env pipeline/besttime.ts          # busiest-hours proxy for demo sites
npm run demo                                          # record a replay run
npm run db:import                                     # JSON bundle -> SQLite (also runs on first start)
npm run db:push-catalog                               # local catalog -> Postgres
npm run sample                                        # rebuild the synthetic public sample
```

Being added this round:
- `pipeline/aerial.ts`: counts parking stalls and rooftop units on cached Vexcel orthos -> `data/processed/aerial/<sid>.json`
- `pipeline/panos.ts`: maps panoramas to rooms and checks named features in the photos -> `data/processed/panos/<sid>/checks.json`
- `pipeline/merge-catalog.ts`: merges the Postgres catalog and the local `shells.json`

## Tests

```bash
npm test                    # vitest
npx tsc --noEmit            # typecheck
npm run e2e                 # Playwright; starts the dev server if needed
npx playwright test e2e/walk.spec.ts --project=desktop   # screenshot walkthrough of a recorded run
npx tsx scripts/try.ts "pediatric clinic in Houston, two exam rooms with sinks"   # CLI agent run
```

## Honesty rules

- A space without a scan is labeled record-only. Empty CoStar fields are unknown, never a pass.
- Every number links to its source: a CoStar field, a scan room or photo, a Vexcel count, or a cited rule.
- Photo checks report seen, not seen or couldn't tell, always with the photo. No accuracy claims.
- Scans can't see wiring, gas, drains or grease interceptors. Those become questions for the landlord.
- Foot traffic and walkability are labeled proxies. Garage parking can't be counted from the air.
- A listing on record isn't live availability. Rules and costs are screening flags and ranges.
- Never say "compliant", "fraud" or "guaranteed". Messages are drafts; Hermit never sends them.
- Never commit `data/`, `.env*`, CoStar kit data, `models_index.csv`, panoramas or imagery.
