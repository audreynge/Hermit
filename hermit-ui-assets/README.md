# Hermit UI assets & motion handoff

A lightweight, editable **SVG + CSS + React** asset pack for the Hermit homepage and property search interface.

## What is included

- `assets/hero-coast.svg` — quiet beach scene + small crab for homepage hero.
- `assets/shoreline-top.svg` — thin shoreline band for the search page upper right.
- `assets/shoreline-bottom.svg` — thin sand/ocean footer band.
- `assets/crab-mascot.svg` — simplified illustrative crab for search loading, **not** the team's official logo.
- `assets/starfish.svg`, `assets/shell.svg`, `assets/sandcastle.svg` — optional small accent icons. Prefer one or fewer accents per page.
- `src/tokens.css` — semantic design tokens.
- `src/animations.css` — named keyframes, hover behavior and reduced motion.
- `src/hermit-components.css` — layout styling for ready-to-use components.
- `src/CoastalDecor.tsx` — React/TypeScript decoration, crab loader and property skeleton.
- `docs/CLAUDE_IMPLEMENTATION_PROMPT.md` — detailed implementation instructions for Claude.
- `references/` — the two screenshot references you supplied.

## Quick start

1. Copy `assets/` contents to `public/hermit-assets/` in your React/Next.js project.
2. Copy `src/` files into your source tree; import `./hermit-components.css` once.
3. Use `CoastalTop` / `CoastalBottom` within a parent with `position: relative` and `overflow: hidden`. Other content should sit above them with `position: relative; z-index: 1`.
4. Use `HeroCoast` on the right of the homepage hero and `CrabLoader` / `PropertySkeleton` while searching.
5. Give Claude the reference screenshots and `docs/CLAUDE_IMPLEMENTATION_PROMPT.md`.

The included `crab-mascot.svg` is an original simplified depiction inspired by the visual references, **not** a faithful extraction of your exact logo. Replace with the official supplied logo where brand fidelity matters.

Animations are CSS-native, low overhead, and automatically disabled when the visitor requests reduced motion.
