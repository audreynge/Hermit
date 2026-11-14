# Hermit: Chat-Only App, Database, Property Viewer and Regulation Agent: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hermit one chat tab that takes words, quick-tap answers or a design (drawn or uploaded). It searches a database-backed index, lets people view each property in Matterport 3D and Vexcel aerial and oblique imagery, and uses an LLM research agent to find the city, county and state rules that apply. A repeated bug-fix loop hardens it.

**Architecture:**
- **Storage:** one SQLite database (`node:sqlite`, built into Node 22) replaces the JSON bundle files, replay files and browser storage. Repository modules keep today's function signatures, so callers don't change.
- **Chat UI:** `/` becomes the only working tab. The survey questions become chat turns with tap-to-answer cards. Design input attaches to the composer: draw a layout in a sheet, or upload a floor plan that Claude vision reads into rooms.
- **Agents:** the search planner (Claude when a key is set) gains a `research_regulations` tool. That tool runs a Claude sub-agent with web search restricted to official domains, plus a verified LA zoning GIS lookup. Findings are cached in the database and become cited screening checks.

**Tech stack:** Next.js 16, TypeScript, `node:sqlite`, `@anthropic-ai/sdk` (`claude-opus-5-5`; server tool `web_search_20260209`; vision input), Matterport Model API and Showcase embed/SDK, Vexcel API 2.0, vitest, Playwright and axe.

**Spec:** `CLAUDE.md` and `docs/DESIGN.md` (product brief and design), together with the user's request of 2026-11-14:
- Iterative bug fixing.
- A true chatbot.
- Migrate to a database.
- Remove the survey tab; everything happens in chat.
- Design input in chat.
- View properties in Matterport and in Vexcel plane imagery.
- An agent or API caller that finds city and state regulations automatically.
- Present the plan before executing.

## Decisions needed before execution

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Database | **SQLite file on the host machine.** The app is served from this Mac over ngrok, so a single file is the simplest option and adds no dependency. Supabase Postgres is the alternative if a Vercel deploy is coming soon; only the driver in `lib/db/index.ts` would change. | Phase 1 |
| D2 | Vexcel credentials | The `.env` token returns 401 everywhere. Provide a Vexcel username and password, so the server can log in at `POST https://api.vexcelgroup.com/v2/auth/login` and refresh the token itself, or provide a fresh token. | Task 8 |
| D3 | `ANTHROPIC_API_KEY` | Required for LLM dispatch, floor-plan upload (vision) and the regulation agent. Use `scripts/set-anthropic-key.sh`. | Tasks 6, 10, 11 (deterministic fallbacks keep everything else working) |
| D4 | What "input a design" means | **Both:** (a) draw a layout inside the chat, and (b) upload a floor-plan image or PDF. | Task 6 |
| D5 | Matterport SDK domain | The SDK key's allowed domain is `http://localhost3000` (no colon). Add `localhost:3000` and the ngrok domain in Matterport's developer settings, so room-jump controls work. The plain 3D embed already works without this. | Task 7, SDK part only |

## Global Constraints

- A null record field is `unknown`, never `pass`. Never call a property available without listing evidence. Inquiries are drafts only and are never sent.
- No CoStar or Matterport data, database file or credentials in git: `data/processed/` stays ignored, and `data/sample/` stays synthetic.
- Agent budgets: ≤25 tool calls per run (enforced on every call), ≤8 room graphs, ≤4 `inspect_view` calls, 40 s planner time, live result under 45 s.
- Every regulation finding carries a source URL, cited text, jurisdiction and retrieval date. It is labeled a screening item to verify with the jurisdiction. Every URL must have been returned by that run's web search.
- Secrets stay on the server: the Vexcel token and the Anthropic key are never sent to the browser. Only the domain-restricted Matterport SDK key may be public (`NEXT_PUBLIC_MATTERPORT_SDK_KEY`).
- WCAG 2.2 AA: axe passes on every page and dialog, everything works by keyboard, and reduced motion is respected.
- Model: `claude-opus-5-5` with `output_config.effort: "low"` for chat turns and `"medium"` for regulation research. Use `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) on the planner and research calls.
- Comments: 1–2 lines, only for non-obvious constraints. Commits carry no AI attribution. Work happens on branch `hermit-app` in PR #1; never push to `main`.

## Review Focus

1. **Wrong or outdated rules.** The research agent may return a rule that has since changed. Each finding shows its retrieval date and "verify with the city". Findings whose URL is outside the allowlist, or wasn't in the search results, are dropped (test in Task 10).
2. **Bad uploads.** If someone uploads a photo that isn't a floor plan, or an unreadable PDF, Hermit says it couldn't read a floor plan and asks again. The spec stays unchanged (test in Task 6).
3. **Concurrent writes.** Two requests writing at once (two tabs, or a replay during a live run) must not fail with "database is locked". Use WAL mode, `busy_timeout = 3000`, and append-only message inserts (test in Task 2).
4. **LLM failure mid-conversation.** If the Claude call fails partway through, the same conversation continues with the deterministic turn, nothing already captured is lost, and the trace shows the fallback (test in Task 5).
5. **Off-topic or empty messages.** Messages like "hi", "??" or pasted junk get a friendly redirect with chips. They never crash, and replies never contain "undefined" or "NaN" (test in Task 12's explorer invariants).

---

## Phase 0: Fix known bugs

### Task 1: Fix bugs found in review so far

**Files:** `lib/chat/converse.ts`, `lib/chat/present.ts`, `components/SearchChat.tsx`, `pipeline/matterport.ts`. Tests go in the matching `*.test.ts`.

**Interfaces:** no new exports.

Known bugs, each one getting a regression test before its fix:

- [ ] **"Make it bigger" quick reply does nothing.** `mergeText` has no relative-size handling. Test `converse(results, "Make it bigger")` → `ready: true` and `sizeSqft` scaled ×1.5 on both ends. Same for "smaller" (×0.67) and "cheaper" (`budgetMonthly` ×0.8).
- [ ] **"Enough parking for the use" appears when parking was never asked about.** Test `highlights(...)` with `needs: {}` and only a `parking` pass rule: parking can be the third bullet only if no stronger reason exists, and it must never come before prior use.
- [ ] **Replay shows the placeholder use type "space" until the run event arrives.** Test in e2e: the replay conversation's first bot reply names the recorded spec's `useType`.
- [ ] **Old room graphs have wrong `heightFt`.** They were fetched before the units fix. Run `pipeline/matterport.ts --refresh-height`, which recomputes `heightFt` from the stored `units`. No API calls are needed if `units` is stored; otherwise refetch. Test in `transform.test.ts` (already covered); the step adds the script flag.
- [ ] **The composer stays disabled if `/api/agent` fails.** Test in e2e by routing `/api/agent` to a 500: the bot says the search failed, and `Send` is enabled again.
- [ ] Run `npm test` and `npm run e2e`; all pass. Commit with the message `fix: relative size refinement, parking highlight, replay spec, composer recovery`.

---

## Phase 1: Database

### Task 2: SQLite connection and schema

**Files:** create `lib/db/index.ts` and `lib/db/schema.sql`. Test in `lib/db/db.test.ts`.

**Interfaces:**
- `db(): DatabaseSync`: a per-process singleton. The path is `process.env.HERMIT_DB ?? path.join(dataDir(), "hermit.db")`. Sets `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON`. Applies `schema.sql` when `PRAGMA user_version < 1`, then sets it to 1.
- `tx<T>(fn: () => T): T`: wraps `fn` in BEGIN/COMMIT, with ROLLBACK on throw.
- Tables in `schema.sql`:
  - `shells(id TEXT PK, sid TEXT, mode TEXT, city TEXT, sqft REAL, json TEXT NOT NULL)` with an index on `(city, mode)`
  - `roomgraphs(sid TEXT PK, json TEXT NOT NULL)`
  - `runs(id TEXT PK, created_at TEXT, spec_json TEXT, events_json TEXT)`
  - `conversations(id TEXT PK, viewer_id TEXT, created_at TEXT, updated_at TEXT, state_json TEXT)`
  - `messages(id TEXT PK, conversation_id TEXT REFERENCES conversations(id), seq INTEGER, role TEXT, kind TEXT, payload_json TEXT, created_at TEXT)` with a unique index on `(conversation_id, seq)`
  - `saved(viewer_id TEXT, shell_id TEXT, report_json TEXT, spec_json TEXT, saved_at TEXT, PRIMARY KEY(viewer_id, shell_id))`
  - `designs(id TEXT PK, conversation_id TEXT, kind TEXT CHECK(kind IN ('layout','upload')), json TEXT, created_at TEXT)`
  - `regulation_findings(cache_key TEXT PK, json TEXT, fetched_at TEXT, expires_at TEXT)`

- [ ] **Step 1: Test `migrates an empty database once`.** Point `HERMIT_DB` at a temp file, call `db()` twice, then expect `user_version` = 1 and all 8 tables in `sqlite_master`.
- [ ] **Step 2: Test `survives concurrent writers`.** Two `DatabaseSync` handles on the same file insert 200 messages each inside `tx`. Expect 400 rows and no throw.
- [ ] **Step 3: Run the tests and see them fail. Implement. See them pass. Commit** `feat(db): sqlite schema and connection`.

### Task 3: Move bundle and replays into the database

**Files:** create `pipeline/import-db.ts`. Modify `lib/query/load.ts`, `lib/agent/replay.ts`, `pipeline/sample.ts` and `package.json` (add `"db:import": "tsx pipeline/import-db.ts"`). Tests: the existing `lib/query/load.test.ts` and `lib/agent/replay.test.ts`, updated to use a temp `HERMIT_DB`.

**Interfaces:**
- Consumes `db()` and `tx()` from Task 2.
- Produces unchanged signatures: `loadShells(): Shell[]` (still cached in memory), `getShell(id)`, `loadRoomGraph(sid)`, `saveRun`, `loadRun`, `listRuns`. Adds `searchCandidates(city: City, modes: Mode[]): Shell[]`, which selects by `(city, mode)` so search no longer scans all 2,659 rows.
- `import-db.ts` reads `data/processed/shells.json`, `roomgraphs/*.json` and `replay/*.json` into the database in one transaction. It is idempotent (`INSERT OR REPLACE`). `pipeline/sample.ts` writes `data/sample/hermit.db` with the same importer.

- [ ] **Step 1:** Update `load.test.ts` to seed a temp database through `importBundle(dir)` and assert the same behaviors, including that `loadRoomGraph("../shells")` returns null.
- [ ] **Step 2:** Add test `searchCandidates only returns the requested city and modes`.
- [ ] **Step 3:** Run, fail, implement, pass. Run `npm run db:import` on the real bundle and expect it to log `2659 shells, 1398 room graphs, N runs`. Run the full `npm test`. Commit `feat(db): bundle, room graphs and replays in sqlite`.

### Task 4: Conversations, messages and saved spaces on the server

**Files:**
- Create `lib/db/conversations.ts`, `app/api/conversations/[id]/route.ts` and `app/api/saved/route.ts`.
- Modify `app/api/chat/route.ts`, `components/SearchChat.tsx` and `components/SavedList.tsx`, and delete `lib/client/store.ts`'s chat and saved keys.
- Test in `lib/db/conversations.test.ts`.

**Interfaces:**
- `createConversation(viewerId: string): string`
- `appendMessages(id: string, msgs: StoredMsg[]): void`, which assigns `seq` inside `tx`
- `loadConversation(id): { state: ChatState; messages: StoredMsg[] } | null`
- `saveSpace(viewerId, report, spec)`, `unsaveSpace(viewerId, shellId)` and `listSaved(viewerId)`
- `StoredMsg = { role: "user" | "bot"; kind: "text" | "thinking" | "compare" | "design" | "results"; payload: unknown }`
- Viewer identity is a random `hermit_vid` cookie (httpOnly, SameSite=Lax, 1-year max-age), set by middleware-free logic in the API routes on first request.
- `/api/chat` now takes `{ conversationId?, text }`. It loads state from the database, appends the user and bot messages, and returns `{ conversationId, turn }`. The client keeps `conversationId` in the URL (`/?c=<id>`) so reloads and shared links restore the chat.

- [ ] **Step 1:** Tests: `appends with increasing seq across calls`, `restores state and messages`, `saved spaces are per viewer`.
- [ ] **Step 2:** Run, fail, implement, pass.
- [ ] **Step 3:** E2E: reloading `/?c=…` shows the same conversation, and a saved space appears on `/saved` in the same browser but not in a fresh browser context.
- [ ] **Step 4:** Commit `feat(db): server-side conversations and saved spaces`.

---

## Phase 2: One chat tab

### Task 5: Survey questions become chat turns; remove the Survey and Layout tabs

**Files:** modify `lib/chat/converse.ts`, `lib/chat/claude.ts`, `components/Chrome.tsx` (nav becomes Chat and Saved), `app/page.tsx` (renders the chat) and `app/layout/page.tsx` (redirects to `/?design=draw`). Delete `components/Survey.tsx`, `components/Stepper.tsx` and `app/search/page.tsx` (which redirects to `/`). Tests: `lib/chat/converse.test.ts` and e2e.

**Interfaces:**
- `Slot` gains `"transaction"` and `"musts"`. `Turn` gains `card?: { kind: "single" | "multi"; options: { value: string; label: string }[] }`, rendered as tap cards. Multi-select cards have a Done button that sends the joined labels.
- The question order stays capped at 4 asks: use → city → size → (rooms or musts, whichever is more useful for the use). Lease/buy is inferred from text ("buy", "purchase", "own" → buy) and asked only when the budget is ambiguous.
- `mergeText` parses multi-select answers: "ADA Accessible, On-site Parking" → `needs.wheelchair` and `needs.parking`.

- [ ] **Step 1:** Tests: `asks must-haves as a multi-select card`, `parses a multi-select answer into needs`, `infers buy from "looking to purchase"`, `never asks more than 4 questions`, and `keeps captured fields when Claude fails mid-conversation` (Review Focus 4: a fake client throws on turn 2 and the state from turn 1 survives).
- [ ] **Step 2:** Run, fail, implement, pass.
- [ ] **Step 3:** E2E: the nav has only Chat and Saved, `/layout` lands on the chat with the draw sheet open, and the medical, warehouse and home flows complete from chat alone.
- [ ] **Step 4:** Commit `feat(chat): survey folded into the conversation`.

### Task 6: Design input: draw or upload

**Files:**
- Create `components/DesignSheet.tsx` (wraps `LayoutStudio` with an `onDone(blocks)` prop), `lib/design/extract.ts` and `app/api/design/route.ts`.
- Modify `components/LayoutStudio.tsx` (add an `onDone` prop and drop its own CTA routing when embedded) and `components/SearchChat.tsx` (a composer "+" menu with **Draw a layout** and **Upload a floor plan**).
- Tests: `lib/design/extract.test.ts` and e2e.

**Interfaces:**
- `FloorPlanExtraction = { isFloorPlan: boolean; rooms: { label: string; count: number; approxSqft: number | null; fixtures: string[] }[]; totalSqft: number | null; notes: string }`. This is the structured-output schema for Claude vision.
- `extractFloorPlan(file: { mediaType: "image/png" | "image/jpeg" | "application/pdf"; base64: string }, client?): Promise<FloorPlanExtraction>`. For a PDF, send a `document` block. For an image, send an `image` block. Maximum 10 MB, rejected with a 413 before calling Claude.
- `designToDraft(x: FloorPlanExtraction | Block[], base: Draft): Draft`. Blocks go through the existing `fromLayout`. An extraction maps each room to `minSqft = approxSqft * 0.85`.
- `POST /api/design` takes multipart `{ conversationId, file }` or JSON `{ conversationId, blocks }`. It stores a `designs` row, appends a `design` message (an SVG thumbnail of the blocks, or the uploaded image's object URL client-side), merges the result into the conversation's spec, and returns the next `Turn`.
- With no key, upload replies "Reading uploaded plans needs the Claude key; you can draw the layout instead" and drawing still works.

- [ ] **Step 1:** Tests:
  - `maps extracted rooms to requirements` (3 exam rooms of about 110 sf → `minSqft` 94)
  - `rejects a non-floor-plan image` (Review Focus 2: `isFloorPlan: false` leaves the draft unchanged, and the reply asks for a floor plan)
  - `rejects files over 10 MB`
  - `drawn blocks become the same draft as /layout did`
- [ ] **Step 2:** Run, fail, implement, pass.
- [ ] **Step 3:** E2E:
  - Draw: + → Draw a layout → Use this layout puts a design bubble in the chat, then results.
  - Upload: + → Upload with `/api/design` mocked to a fixed extraction gives a design bubble and the follow-up question.
  - Upload with no key gives the fallback message.
- [ ] **Step 4:** Commit `feat(chat): draw or upload a design in the conversation`.

---

## Phase 3: Viewing properties

### Task 7: Room-aware Matterport viewer

**Files:** modify `pipeline/matterport.ts` (add `panoLocations { id }` per room to the query) and `pipeline/transform.ts` (`Room.sweeps: string[]`). Create `components/PropertyViewer.tsx`. Tests: `pipeline/transform.test.ts` and e2e.

**Interfaces:**
- `Room` gains `sweeps: string[]`.
- `PropertyViewer({ report, mode: "3d" | "aerial" | "oblique" | "fit" })` is a large dialog opened from a **View property** button on each card and from the Inside tab.
- 3D mode embeds `https://my.matterport.com/show/?m=<sid>&play=1&qs=1&brand=0`, plus `&ss=<sweep>&sr=0` when jumping to a room. A list of the user's requested rooms appears beside it; clicking "Exam room #1" reloads the embed at that room's first sweep. When `NEXT_PUBLIC_MATTERPORT_SDK_KEY` is set and the domain is allowed (D5), it uses the Showcase SDK `Sweep.moveTo` instead of reloading.

- [ ] **Step 1:** Test `keeps sweep ids per room` in `transform.test.ts`.
- [ ] **Step 2:** Run, fail, implement, pass. Re-run `npm run matterport -- --refresh` (resumable, about 3 minutes) and `npm run db:import`.
- [ ] **Step 3:** E2E: View property opens a dialog, the iframe `src` contains `m=`, and clicking a room button changes `src` to include `ss=`. Run axe on the dialog.
- [ ] **Step 4:** Commit `feat(viewer): room-aware Matterport viewer`.

### Task 8: Vexcel orthophoto and oblique ("plane") imagery

**Blocked by D2.**

**Files:** create `lib/vexcel/client.ts` and `app/api/vexcel/route.ts`. Modify `components/PropertyViewer.tsx` and `components/Aerial.tsx`. Test in `lib/vexcel/client.test.ts`.

- [ ] **Step 1: Verify before building.** Log in with the supplied credentials and open `/v2/swagger-ui/index.html?token=…`. Record the exact ortho and oblique endpoint paths, their parameters (lat, lon, zoom or extent, direction N/E/S/W, layer), and the token lifetime in `docs/DESIGN.md` §2, under the Vexcel row. No endpoint gets coded until it appears in the swagger output.
- [ ] **Step 2: Tests.**
  - `logs in once and reuses the token until expiry` (fetch is injected; two image calls make one login call)
  - `re-logs in on 401 once`
  - The route `rejects lat/lon outside Houston/LA bounding boxes and non-N/E/S/W directions` with a 400.
- [ ] **Step 3: Implement.**
  - `vexcelImage({ lat, lon, kind: "ortho" | "oblique", direction?: "N" | "E" | "S" | "W" }, fetchFn = fetch): Promise<Response>` runs on the server only.
  - `GET /api/vexcel?lat&lon&kind&direction` streams the image with `Cache-Control: private, max-age=86400`.
  - The Above tab and the PropertyViewer aerial and oblique modes use Vexcel when `/api/vexcel` answers 200, and fall back to Esri otherwise. The caption names whichever provider served the image.
- [ ] **Step 4:** E2E: the viewer's oblique mode shows four direction buttons. With `/api/vexcel` mocked to 503, the caption reads Esri.
- [ ] **Step 5:** Commit `feat(viewer): Vexcel ortho and oblique imagery via server proxy`.

---

## Phase 4: Regulation agent

### Task 9: Verified LA parcel zoning lookup

**Files:** create `lib/regs/zoning.ts`. Test in `lib/regs/zoning.test.ts`.

- [ ] **Step 1: Verify.** Find a public City of Los Angeles zoning layer, starting from data.lacity.org's zoning dataset and SCAG's `LDX/Zoning_poly_LA` MapServer. Confirm that a point query returns a zone code for 3 known addresses whose CoStar `zoningDescription` we already have. Record the URL and field name in `docs/DESIGN.md`. If none verifies, skip this task and record that in the README. CoStar zoning plus the research agent still cover zoning.
- [ ] **Step 2:** Tests:
  - `parses the zone code from an ArcGIS point query` (a fixture JSON from the verified layer)
  - `returns null outside LA`
  - `flags disagreement with the CoStar zone` (`checkRules` gets a `warn` "zoning records disagree")
- [ ] **Step 3:** Implement `lookupZoning(lat: number, lon: number, fetchFn = fetch): Promise<{ zone: string; source: string } | null>`. Results are cached in `regulation_findings` under the key `zoning:<lat5>,<lon5>`.
- [ ] **Step 4:** Commit `feat(regs): LA parcel zoning lookup`.

### Task 10: Regulation research sub-agent

**Files:** create `lib/regs/research.ts` and `lib/regs/domains.ts`. Test in `lib/regs/research.test.ts`.

**Interfaces:**
- `Finding = { topic: "zoning" | "business_license" | "occupancy" | "health" | "professional_license" | "parking" | "accessibility" | "fire" | "signage"; jurisdiction: "city" | "county" | "state" | "federal"; requirement: string; appliesWhen: string; certainty: "applies" | "may_apply"; url: string; citedText: string; retrievedAt: string }`
- `researchRegulations(q: { city: City; useType: string; zoning?: string | null }, client?): Promise<{ findings: Finding[]; fromCache: boolean }>`
- **The call:** one `messages.create` on `claude-opus-5-5` with:
  - tools: `[{ type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_domains: OFFICIAL_DOMAINS }]`
  - `output_config.format` set to the Findings schema
  - effort `medium`
- `OFFICIAL_DOMAINS` in `domains.ts`: `lacity.gov`, `dbs.lacity.gov`, `planning.lacity.gov`, `codelibrary.amlegal.com`, `finance.lacity.gov`, `publichealth.lacounty.gov`, `dca.ca.gov`, `barbercosmo.ca.gov`, `leginfo.legislature.ca.gov`, `houstontx.gov`, `houstonpermittingcenter.org`, `library.municode.com`, `hcphes.org`, `tdlr.texas.gov`, `dshs.texas.gov`, `statutes.capitol.texas.gov`, `ada.gov`, `nfpa.org`.
- **After parsing:**
  - Drop any finding whose `url` is not one of the URLs in that response's `web_search_tool_result` blocks, or whose host is not in `OFFICIAL_DOMAINS`.
  - Cache under `regs:<city>:<useCategory>` for 30 days.
  - Without a client, return the deterministic `rules/screening.json` rows mapped to `Finding`, with `certainty: "may_apply"` and `fromCache: false`.

- [ ] **Step 1:** Tests, using a fake client that returns `web_search_tool_result` blocks and parsed output:
  - `keeps findings whose url came from the search results`
  - `drops a finding with a url the search never returned` (Review Focus 1)
  - `drops a non-official domain`
  - `serves the second identical query from cache without calling the client`
  - `falls back to screening rules with no client`
- [ ] **Step 2:** Run, fail, implement, pass. Commit `feat(regs): regulation research sub-agent with verified citations`.

### Task 11: Wire regulations into the agent and the chat

**Files:** modify `lib/agent/tools.ts`, `lib/agent/loop.ts`, `lib/agent/report.ts`, `lib/chat/present.ts`, `lib/chat/converse.ts` and `components/ReportPanel.tsx`. Tests: `lib/agent/agent.test.ts`, `lib/chat/present.test.ts` and `lib/chat/converse.test.ts`.

**Interfaces:**
- New tool `research_regulations: z.object({})`. It runs once per search, counts toward the 25-call budget, and attaches findings to `Run.regulations`.
- `buildReport` adds each finding as a `RuleHit`: `rule: "reg_<topic>"`, `status: "unknown"` for `may_apply` and `"warn"` for `applies`, `citation: url`, and evidence `{ source: <jurisdiction>, ref: citedText.slice(0, 160), confidence: 0.6 }`. It adds an "Ask before you commit" question per `applies` finding.
- Thinking step: `{ icon: "gavel", label: "Researching <City> and <State> rules for a <useType>" }`, plus one step per jurisdiction found ("Found 3 state licensing rules").
- Chat intent: messages like "what permits/licenses/regulations…" return `action: "regulations"`. The UI then renders a findings card grouped by jurisdiction, with links and retrieval dates.

- [ ] **Step 1:** Tests:
  - `adds cited regulation checks to every report`
  - `research counts toward the tool budget`
  - `regulation steps appear in the thinking list`
  - `routes "what permits do I need" to the regulations action`
- [ ] **Step 2:** Run, fail, implement, pass.
- [ ] **Step 3:** E2E with `/api/agent` running against a fake research result through `HERMIT_FAKE_REGS=1`, an env-only switch: reports show a "City", "State" or "Federal" group with links, and the "what permits do I need?" chat shows the findings card.
- [ ] **Step 4:** Commit `feat(regs): regulations in search, reports and chat`.

---

## Phase 5: Iterative bug-fix loop

### Task 12: Conversation explorer and fix loop

**Files:** create `scripts/explore.ts` (run with `npm run explore`). The script is the test.

**Interfaces:** `npm run explore -- --base http://localhost:3000 --runs 25` drives `/api/chat` and `/api/agent` through 25 scripted personas. Examples:
- nail salon in LA, $4k/mo
- coffee shop in Houston, needs a hood
- dentist with 4 operatories and ADA
- yoga studio, 2 rooms
- 3PL warehouse needing ESFR and docks
- first home with 3 bed/2 bath under $400k
- someone who only says "hi"
- someone who contradicts themselves
- someone who answers every question with "idk"
- someone who pastes 2,000 characters
- someone who uploads a fake design (mocked)

**Invariants checked per conversation** (failures are written to `test-results/explore.json`):
- No HTTP 5xx.
- Search or a question within 5 user turns.
- No reply containing "undefined", "NaN" or "[object".
- Every report has at least 1 source, and every `reg_*` hit has an https URL.
- No "available" wording without an active listing.
- Live search under 45 s.

**The loop:** run explore, fix each failure test-first (in the owning module's test file, test before code), and repeat. Stop after 2 consecutive clean runs plus green `npm test`, `npm run e2e` and `next build`.

- [ ] **Step 1:** Write `scripts/explore.ts` with the personas and invariants, and run it against the current build. Expected: it lists failures.
- [ ] **Step 2:** Fix each failure with a regression test, and commit each fix separately.
- [ ] **Step 3:** Repeat Step 1 until 2 consecutive clean runs.
- [ ] **Step 4:** Final verification: `npm test`, `npm run e2e` on both dev and prod builds, the sample-bundle e2e subset, and a production build restarted behind the ngrok tunnel. Update the PR #1 description and the README.

---

## Execution order and checkpoints

| Order | Tasks | You'll see after it |
|---|---|---|
| 1 | Task 1 | Known bugs fixed |
| 2 | Tasks 2–4 | Data, chats and saved spaces live in `hermit.db`; reload a chat link and it's still there |
| 3 | Tasks 5–6 | One Chat tab; draw or upload a design in the conversation |
| 4 | Task 7 (Task 8 when D2 arrives) | View property in 3D, jump between rooms, see Vexcel aerial and oblique imagery |
| 5 | Tasks 9–11 (need D3) | Cited city, county, state and federal rules on every report, and "what permits do I need?" in chat |
| 6 | Task 12 | Explorer loop until 2 clean runs, then a final restart on the tunnel |
