# UI overhaul plan

Order: Find a space → report tabs → Inside → chat → Overview → Gmail. Each step ships alone.

## 1. Find a space
- Trace (`components/Thinking.tsx`, `components/studio/Hermit.tsx`): live list of every tool call while running; when done, a collapsed "Checked N things" under Hermit's results message (the last message).
- Remove "View property": delete `components/PropertyViewer.tsx`; the chat's "view" action opens `/shell/{id}?run=…&tab=inside`. Inline fit-out proposals in chat stay.

## 2. Report tabs (`components/report/ShellReportPage.tsx`, `lib/report-chat.ts`)
- Tabs: Overview · Inside · From above · Lease coach · Talk to your broker.
- From above = `Aerial` + Vexcel credit. Delete `Neighborhood.tsx` and `Furnish.tsx`; legacy `?tab=neighborhood` → aerial, `?tab=furnish` → inside.

## 3. Inside (`components/report/Inside.tsx`, `components/FurnishTour.tsx`, `components/FitView.tsx`)
- Top: `FurnishTour` (plain iframe fallback). No crab/bubble.
- Under it: furniture hotbar (Suggested / Placed / Search), docked below the tour, no text box (typing moves to the chat).
- Below: Check the fit, with "Your design vs this space" first and default, then 2D, 3D, Wheelchair. Wheelchair: drop the figcaption description, keep legend. Design rebuilt from the saved Find-a-space layout (falls back to 2D plan).
- Remove "Ask about this space" + log + composer and the Back/Next guided bar. Floor plan + room list stay.

## 4. One floating Hermit chat (`components/report/ReportChat.tsx`, `/api/report-chat`)
- Closed by default: speech-bubble button bottom-right. Open: panel, draggable by header, clamped to viewport, position in sessionStorage, Esc closes.
- Replies only in the panel (no toast).
- Typed actions: `tab`, `save` (existing); `furnish` → FurnishTour logic (switches to Inside); `fitout` → `/api/fitout`, proposal with Keep/Undo in Check the fit; otherwise answer with `/api/ask` scan context. "Add to my broker questions" moves here.

## 5. Overview (`components/report/Overview.tsx`)
- Remove "Will it fit", "How soon can I open", "Screening only…".
- Left: Compliance ordered ✕ → ⚠ → ? (licenses with ⚠).
- Right: verdict card, Questions to ask (failed/warning checks, hard fails, unknowns; ~5), Talk to your broker button.
- Broker: drop "Screening summary…" on screen only; keep it in the PDF.

## 6. Gmail
- `gmailUrl(to, subject, body)` → `https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…`, new tab.
- Used by Messages "Open in my email app", broker Send step, and Find a space email draft. Body links the packet PDF; Copy message stays as fallback.

## Notes
- Keep one short screening disclaimer in the page footer once the Overview/Broker lines go.
