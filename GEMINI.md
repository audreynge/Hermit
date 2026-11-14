# Hermit — notes for Gemini CLI

Hermit finds existing spaces in **Houston** or **Los Angeles** that are already built for what someone needs, shows the evidence, and lists the work still required. It is a screening tool, not an inspection, code-compliance certificate, or availability guarantee.

## Using the `hermit` MCP server

- Quick answer: `parse_request` (plain English → RequirementSpec) → `find_spaces` (whole funnel, ≤5 ranked Shell Reports).
- Plan it yourself: `parse_request` → `start_search` (gives `runId`) → `search_shells` → `match_layout` (only if the spec has a drawn layout) → `screen_sites` (≤20 ids) → `evaluate_candidates` (≤8 ids) → optional `inspect_view` / `drop_candidate` → `submit_reports` (≤5 ids, your rank order).
- Drawn floor plan (rooms as rectangles in feet): `similar_layouts`, with `scale` to match it smaller/larger.
- Finished runs return a `replay` path; open `http://localhost:3100<replay>` (or :3000 on the main checkout) to see the run in the app.

## Rules

- Every number comes from a tool result. Never invent measurements, compliance, or availability.
- Null record fields are **unknown**, not passes. Say so, and turn them into questions for the landlord.
- Never describe a space as available without listing evidence. Draft inquiries only; never send them.
- CoStar records, Matterport data, `data/processed/` and `.env` are private: don't paste them outside this machine or commit them.
