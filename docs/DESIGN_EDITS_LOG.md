# Design edits: loop log

The thresholds are in `docs/DESIGN_EDITS_PLAN.md` §5. The language eval runs through the `claude` CLI (Opus 5.5, effort low), because no `ANTHROPIC_API_KEY` is set. Browser tests run on port 3100, because port 3000 is used by an unrelated local process.

## Iteration 1 (baseline after the first implementation)

| Gate | Result |
|---|---|
| typecheck | pass |
| unit tests | 164/164 |
| build | pass |
| e2e | not run yet |
| eval | **missed 4**: op match 83.7% (≥90), claims 2 (≤0), latency p50 4.06 s (≤3), p95 6.02 s (≤6). Target 96.9%, ambiguous 100%, unsafe 100% |

**What failed and why:**
- **The model used display names as labels.** It wrote "Exam Room 3" as a room type (M03, T01) and "Exam Room 1" for converted rooms (M04). In M04 this was a real scoring bug: the converted bedrooms got stored as "exam room 1", didn't match the "exam room" requirement, and **fit fell from 100 to 72**.
- **The model invented details:** sizes and positions for "add another exam room" (L01, L13), and merge labels like "living + kitchen" (F04, F12).
- **The claim check was wrong:** it flagged refusals ("I can't certify that a space is ADA compliant").
- **F11 golden case was wrong:** it asked to add a toilet to a bathroom, but bathrooms already imply one. The model correctly said so and asked whether a second toilet was meant.
- **Slow output:** the output schema forced about 13 `null` fields per op plus a full `update` object.

## Iteration 2

**Changes:**
- **Labels:** `roomType` strips trailing ordinals ("Exam Room 3" → "exam room"). Fit-out labels map to catalog types ("consult room" → "exam room"). This fixed the M04 scoring bug at the root.
- **Defaults instead of guesses:** "another exam room" now copies the size of the existing exam rooms and sits next to them in code. The prompt tells the model to leave out sizes, positions, counts and merge labels the user didn't give.
- **Faster output:** chat output fields are optional rather than nullable, so the model writes only what changed. This touches the existing `ChatOut` update object. Every existing chat test still passes.
- **Eval measurement fix:** a sentence with a negation ("can't", "only a…") isn't counted as a claim.
- **Golden case F11:** now "add a shower to the second bathroom", a fixture that isn't implied.
- **Layout Studio bug (existing code):** it saved its template before loading the stored layout. In dev, React runs mount effects twice, so the template wiped out layouts edited in the chat. It now saves only after loading. Found by [E1].
- **Offline chat regression:** "make it 2,500–4,000 sq ft" during results got the edit help text. Messages the edit parser doesn't recognize now go to the search conversation first.
- **Test updates:** [L15]'s expected `minSqft` changed with the new size defaults. The e2e card selector now uses "measured".

| Gate | Result |
|---|---|
| typecheck | pass |
| unit tests | 164/164; all 44 named cases [L1–L16, F1–F16, C1–C7, E1–E5] present |
| build | pass (exit 0) |
| e2e | 27/27 (5 new + 22 existing), axe clean |
| eval (65 cases) | **all met**: op match 100%, target 100%, ambiguous asked 100%, unsafe 100% with zero wrong ops, 0 bad ids, 0 claims, 0 prices, 0 errors, latency p50 2.72 s, p95 4.07 s |

**Next:** run iteration 3 for the second green in a row. Median latency is close to its threshold (2.72–2.92 s against 3 s), so check how much it varies between runs.
