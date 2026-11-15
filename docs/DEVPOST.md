# Hermit

> Hermit crabs don't build their shells. They find one that already fits.

**Tell Hermit what you need. It finds the space that's already built for it, and shows you exactly what's left to do.**

Built for CoStar's "Inside and Out: AI for the Built World" track at HackPrinceton 2026.

## Who it's for

A first-time business owner choosing a space, like a pediatrician in Houston opening her own practice. She needs two exam rooms with sinks off a hallway, a small lab, step-free entry and parking for ten. She can't afford a tenant rep or a contractor at every tour. Hermit also covers renters and buyers (Home mode) and larger site searches (Enterprise mode).

## The problem

A listing doesn't tell you what's inside a space or whether it fits. People tour, bring contractors and find dealbreakers late: no plumbing in the back rooms, too few parking spaces, a use the zoning doesn't allow. The evidence that would have answered those questions sits in three separate places: building records, interior scans and aerial imagery.

## How it works

1. **Say it, sketch it, or answer a short survey.** Hermit turns a spoken sentence or a dragged-in room layout into a checklist she can edit.
2. **One agent plans the search and runs specialist checks.** It screens cheap evidence first and reaches for expensive evidence only for promising spaces:
   - **CoStar records:** use and prior use, parking, sprinklers, power, zoning, listings.
   - **Matterport scans:** room graphs and measured areas from the scan, plus the real panorama photos. When it's unsure whether an exam room has a sink, "Hermit looked closer" opens the photo of that room and reports seen, not seen or couldn't tell, always with the photo.
   - **Vexcel aerials:** parking stalls and rooftop units counted on the orthophoto.
3. **It changes course on evidence.** "How Hermit decided" shows the spaces it ruled out and why (for example, an aerial showing room for far fewer cars than she needs), where it looked closer, and why its top pick changed.
4. **Shell Report.** Her layout drawn on the real floor plan; for each claim, the CoStar record, the scan and the aerial side by side; the work left and weeks to open; a 3D tour; questions for the landlord about what a scan can't see; "Also fits" (other uses the space suits, the landlord side of the market); and a drafted message to the listing broker. Hermit never sends it.

The model only plans and explains. Deterministic tools do the measuring and counting, and every number links to its source: a CoStar field, a scan room or photo, an aerial count, or a cited rule.

## What's real and what's a proxy

| Real (from the data) | Proxy or estimate (labeled on screen) |
|---|---|
| CoStar record fields, shown as unknown when empty | Foot traffic and walkability |
| Room graphs and measured areas from Matterport scans | Parking counted "around the building" unless clipped to the lot |
| Photo checks, always shown with the photo | Weeks to open and cost, as sourced screening ranges |
| Vexcel parking and rooftop-unit counts | Zoning, ADA, fire and HVAC results, as screening flags with citations |

## Built with

Next.js 16 (App Router), React 19, TypeScript, Vercel; Gemini as the planner and photo and aerial reader (Claude when an Anthropic key is set); CoStar hackathon kit; Matterport GraphQL API and Showcase SDK; Vexcel imagery API; SQLite and Supabase Postgres; OpenStreetMap, US Census and Caltrans/TxDOT traffic counts for neighborhood context; ElevenLabs for voice; Vitest and Playwright.

## Limitations

- **Inventory.** The dataset has only a handful of real clinics and other small-business suites; most scans are apartments. The method works for any use, and inventory is the constraint.
- **Proxies.** Foot traffic and walkability are proxies. Garage parking can't be counted from the air, and Hermit says so.
- **No live availability.** A listing on record isn't proof a space is available today; the broker confirms.
- **No hidden infrastructure.** Scans and photos can't see wiring capacity, gas, drains or grease interceptors behind walls. Those become questions, never passes.
- **No accuracy number for photo checks.** We have no hand labels, so we show the photo every time instead of claiming a score.
- **Screening, not certification.** Rule results are flags with citations, not permit or code determinations.

## What's next

- More commercial scans, so Business mode has real choice in every use.
- Landlord view: for any scanned space, the uses it already suits and the work a tenant avoids.
- Hand-labeled photo checks, so we can publish precision and recall.
- Live listing status from CoStar, so a match can say whether the space is on the market today.
