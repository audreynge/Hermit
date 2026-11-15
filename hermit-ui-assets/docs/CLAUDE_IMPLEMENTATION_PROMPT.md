# Claude handoff prompt — Hermit commercial real-estate UI

Build the supplied two-page UI based on the two visual reference screenshots. Keep the visual hierarchy and core functionality of the screenshots, but use the SVG/CSS assets in this package for decorative elements and motion. The screenshot showing the Houston clinic search is the search/results page. The screenshot with “Find a space that already fits” is the homepage.

## Product
Hermit helps businesses find prebuilt commercial spaces suited to their operating requirements. This is a **commercial real-estate search product**, not a children's app or a game. The brand should be approachable but trustworthy and data-forward.

## Design system
- Background: warm off-white `#FFF9F4`; content surfaces `#FFFEFC`; text `#3D2B27`; muted text `#75635E`.
- Accent: coral `#FB6A4A` for CTAs, active nav, match/check icons; hover `#E95C3E`.
- Ocean blue `#78C9E6` and mint `#E8F3F0` used sparingly for ornamental coastline and assistant messages.
- Thin warm borders `#EEDFD5`, shadows `0 8px 24px rgba(84,52,39,.07)`, 12–28px corners.
- Typography: use a robust sans such as Nunito Sans or Plus Jakarta Sans for display, Inter for body; use a system fallback. Maintain readable contrast.
- Do not put illustrations behind dense data content. Preserve ample whitespace; the scenery is a frame, not a dominant subject.

## Homepage
- Top nav: logo/wordmark left, Home, Find a space, Saved, Messages, settings right. Use the **actual Hermit logo supplied by the team** for the nav; the included crab-mascot is illustrative, not a faithful logo reproduction.
- Large left-aligned headline: “Find a space that already fits.”; coral emphasize “already fits.”.
- Short copy about prebuilt commercial spaces; wide natural-language search field; coral primary button “Find my shell”.
- Right side: use `hero-coast.svg` as a restrained illustration, not full-screen wallpaper.
- Bottom: three clean cards “Find a Space”, “Compare Options”, “Plan Your Layout”, with simple line icons. Do not fill them with extra beach toys.
- Optional: tiny starfish near the footer, one shell detail, waves in the upper-right. Avoid more than two decorative beach items in a single viewport.

## Search/results page
- Keep **two columns** on desktop: chat pane ~42%, matching spaces pane ~58%, both independently scrollable at appropriate breakpoints. Chat composer pinned at bottom of left pane.
- Right pane: results header + count, map with numbered pins, real property image cards with name, size, asking rent, location, fit criteria, accessibility caveats, view/report actions. Preserve factual states and don't invent availability, map pins or compliance claims.
- When loading: `CrabLoader` in the chat pane and `PropertySkeleton` in results region. Transition into results with `hermit-enter`; apply staggered delays around 70ms per card (max 350ms).
- No perpetual fake progress: if percentage is unknown, use indeterminate status and three-dot animation; if actual step progress is known, use measured completion values.
- Use `shoreline-top.svg` only in the **thin upper-right margin** and `shoreline-bottom.svg` as a quiet footer accent. Keep all interaction surfaces above decoration.
- Focus effects: light coral border and clear visible focus outline. Avoid moving the main layout when loading finishes.

## Animation specification
| Motion | CSS / asset | Timing | Notes |
|---|---|---|---|
| Upper-right ocean texture | `.hermit-water-motion` | 18s linear infinite | Low opacity, thin strip, no motion under copy |
| Decorative crab bob | `.hermit-crab-motion` | 4s ease-in-out infinite | Max 4px; use mainly in loader |
| Small starfish wiggle | `.hermit-starfish-motion` | 7s, mostly stationary | At most 5 degrees; only one per page |
| Card entrance | `.hermit-enter` | 480ms ease-out | Initial display only; stagger 70ms |
| Loading card shimmer | `.hermit-shimmer` | 1.7s loop | Only while data pending |
| Progress stripes | `.hermit-progress-fill` | 1.6s loop | Tie width to real progress only |
| Interactive hover | `.hermit-interactive` | 200ms | Max -2px; no large bounces |

**Accessibility:** obey `prefers-reduced-motion`; all decorative SVG images should be aria-hidden when not conveying content. Maintain 44px hit targets on touch. Use `role=status` for active search, clear `aria-busy` on results, don't repeat loading announcements continuously. Keyboard-accessible nav, cards, dialogs, and map controls.

## Implementation steps
1. Copy `assets/*.svg` to your app's `public/hermit-assets/`. Copy `src/*.css` and `src/CoastalDecor.tsx` into your React source directory.
2. Import `hermit-components.css` once in the app and use `CoastalTop`, `CoastalBottom`, `HeroCoast`, `CrabLoader`, `PropertySkeleton` as needed.
3. Implement homepage and search page responsive grid. Preserve current functionality/integrations and swap only the presentation layer.
4. On search, show the loader and skeletons, then hydrate results from **existing data**. Don't hardcode screenshot data into production results.
5. Ensure breakpoints: >=1100px two columns; 700–1099px reduced chat/results split or stacked tabbed view; <700px single column with Map/List toggle and sticky composer.
6. Validate light theme, contrast, reduced-motion behavior, no layout shift, and performance on mobile.

## Asset constraints
SVGs are custom lightweight approximations derived from this visual direction. They are editable vector files, not exact vectorizations of the raster reference screenshots. The packaged code is an integration starter, not a drop-in reproduction of the full pages. No live mapping service, building images, 3D scans, or property data are bundled.
