# Release bug-fix sweep (branch `hermit-release`, PR #5)

Hackathon mode: ship fast. No per-change test runs; one verification pass at the end (typecheck + `npm test` + Playwright on the integrator's side).
Three workstreams run in parallel, each in its own git worktree branched from `hermit-release`; the integrator merges them back.

## WS1: AI is really called, constraints are enforced and independently verified

Known root cause (fixed already in `.env` / `.gemini/settings.json`): `gemini-2.5-flash-lite` returns 404 for new keys, so every Gemini call silently fell back to the deterministic planner. Default model is now `gemini-3.5-flash-lite`.

Scope:
1. **Gemini is actually used:** chat (`lib/chat/claude.ts`), planner (`lib/agent/loop.ts` `geminiLoop`), and anything else that says "Claude" but should use whichever provider is configured (vision upload, regulations research, design-edit chat). If Gemini fails, the reason must be visible: a trace `error` event and a visible fallback note naming the provider. No silent fallback. A retired model (404) auto-falls back to the newest available flash-lite via `pickModel`.
2. **No early truncation:** carry the full candidate evidence through the funnel and cut to the top N only at `submit_reports` and in the final UI. Includes `slice`s of tool results passed to the model, `reasons.slice(0, 3)`, and `top: out.results.slice(0, 20)`. Budgets (room graphs, inspections) stay.
3. **Hard constraints are enforced:** when the user selects accessibility (wheelchair / step-free), ground floor, parking, heavy power, ESFR, drive-in bays and so on, a candidate with recorded evidence of failing is dropped, with a `drop` trace event citing the field. Unknown stays unknown: kept, flagged, and turned into an inquiry question. Never a pass.
4. **Verifier agent:** after reports are built, a second agent pass (`verify_reports`; LLM when a provider is set, deterministic rule check always) re-checks every report against every hard constraint and every claim's source. It flags or demotes violations, emits trace events ("Verified 5 reports against 3 must-haves: 1 demoted"), and its verdict shows on each report.

Criteria:
- The trace's `done` event says `planner: "gemini"` on a live search with `GEMINI_API_KEY` set. Chat replies don't show the fallback note.
- With "wheelchair access" selected, no report has a failing accessibility rule. Unknowns show as unknown with a landlord question.
- Every report carries a verifier verdict, and a deliberately violating report gets flagged.
- `npx tsc --noEmit` is clean.

## WS2: Results UI, Zillow-inspired, with a map

Scope:
1. **Tap-to-pick card** (`MultiCard` in `components/SearchChat.tsx`, "Anything you can't do without? Tap all that apply") and other custom pickers/menus (`attach-menu`, the selects in Layout Studio and SimilarScans): looser spacing, clear selected state, aligned chips, comfortable tap targets (≥44px), consistent with the coral/sand theme.
2. **Results panel:** Zillow-style listing cards. Photo first, big price/size line, a compact facts row (sq ft · match % · rooms · parking), status badge, and less crowding.
3. **Map:** show where the matching properties are (`ShellReport.above.lat/lon`, or `Shell.lat/lon`). Numbered pins that match the card order. Hovering or selecting a card highlights its pin and the other way round. It must fit the results layout on desktop (map beside or above the list) and mobile (collapsible). Prefer no new heavy dependency: tile images like `components/Aerial.tsx` (Esri/OSM tiles) plus absolutely positioned pins. A small dependency is OK only if clearly needed.

Criteria:
- Picker chips have even spacing, don't wrap awkwardly at 390px, and show a visible selected state.
- The results panel shows a map with one pin per result, in sync with the card selection.
- No horizontal scroll at 390px. Theme tokens are reused. Keyboard focus is visible.
- `npx tsc --noEmit` is clean.

## WS3: Bug hunt

An explorer agent walks the app (chat, drawing sheet, results, Fit/3D, saved, shared links, replay, MCP) by reading code and driving the dev server. For each real defect it finds, it dispatches a subagent to fix it (or fixes it directly when the fix is a few lines), then reports a list: issue → fix → commit.

Criteria: each fix is a separate commit with a clear message. Nothing in WS1/WS2 scope gets touched (the explorer leaves those to them). There's a final summary list.

## Integration

The integrator (main session) merges WS1 → WS2 → WS3 into `hermit-release`, resolves conflicts, runs typecheck + unit + e2e once, pushes to PR #5 and notifies the user.
