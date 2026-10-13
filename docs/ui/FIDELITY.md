# Design fidelity — "same to same"

The owner's call (13 Oct): **the design wins everywhere.** Every screen's look
follows the approved canvas (`docs/design-handoff/`). Where a later change
altered a screen's look, the screen goes back to the design. Business rules
(`docs/design-handoff/RULES.md`, CLAUDE.md), fixes, permission checks, server
actions and real data stay. A screen is done when it and its design frame are
the same picture at 1440 and 390 px, in light and (where drawn) dark.

## Where the design is

| What | Where |
|---|---|
| Readable source per module (template, `renderVals()` logic, sample data, copy) | `docs/design-handoff/design/src/<Module>.dc.html` |
| Built copy with every style inlined (exact px, colours, radii) | `docs/design-handoff/design/project/<Module>.dc.html` |
| Frames → module, start state, size | `docs/design-handoff/canvas-index.json`, `docs/design-handoff/SCREENS.md` |
| Screenshots of every frame | `docs/design-handoff/screenshots/<page>/<frame>.webp` |
| Tokens, type, motion, components | `docs/design-handoff/DESIGN-SYSTEM.md`, `src/vx/vx.css` |
| Rules that beat the pictures | `docs/design-handoff/RULES.md` |

A frame file such as `M-Fees-Receipt.dc.html` is a wrapper: it mounts the
module (`<dc-import name="Fees" start="receipt">`). The module's
`st()`/`data()` give the state and the sample records drawn in the frame.

## The loop

1. **Fixture.** Add `tests/mobile-ui/design/<module>.fixture.tsx` exporting
   `views: Record<string, DesignView>` (type in `tests/mobile-ui/design.fixture.tsx`),
   one view per frame, keyed by the frame's name without `.dc.html`. Render the
   production screen component with synthetic props that copy the frame's
   sample data. Server actions are stubbed by the fixture's Vite plugin; no
   database, no sign-in.
2. **Serve.** `npx vite --config tests/mobile-ui/design.vite.config.ts`
   (port 3202; set `FIXTURE_PORT` to run several at once).
   `http://127.0.0.1:3202/design.html` lists every view.
3. **Compare.**
   `node scripts/design-compare.mjs <out> "<name>|view=<view>|<page>/<frame>.webp|1440|900"`
   writes `<out>/<name>.png`, design left and app right. Phone frames are
   `390|844`. Add `&theme=dark` for dark frames, `&menu=teacher` etc. for a
   role's shell. On Windows set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the
   installed Chromium if Playwright asks for a newer build.
4. **Fix** the screen until the pictures agree: layout, order, sizes, type,
   colour, radius, copy, icons, empty and error states. Keep every rule,
   permission check, action and data contract. Do not invent data the app does
   not have: draw the design's layout with what is real and record the gap.
5. **Check.** `npm run typecheck`, `npx eslint <changed files>`, `npx vitest run`.

## Log

| Area | Modules | Status | Notes |
|---|---|---|---|
| Older screens | 85 classic routes | done (#84) | Design top bar and kit geometry; content keeps its old layout |
