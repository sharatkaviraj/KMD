# VPPS One — UI handoff pack

This pack holds everything Claude Code needs to build the approved VPPS One design into the real app (`veerpatta/vppsone`).

## How to use it
1. Unzip into the vppsone repo's `docs/` folder — it creates `docs/design-handoff/`. It is safe to commit (about 21 MB unzipped).
2. Open Claude Code in the repo and paste the prompt from **PROMPT.md** (everything below its line).
3. Claude Code works through **PLAN.md** phases P0–P12, pushing to `main` after each, and keeps `docs/ui/PROGRESS.md` updated. If a session ends, start a new one with: *"Continue the VPPS One UI build from docs/ui/PROGRESS.md, following docs/design-handoff/PROMPT.md."*

## What's inside
| Path | What it is |
|---|---|
| `PROMPT.md` | The master prompt for Claude Code |
| `PLAN.md` | Rollout ideas and phases P0–P12 |
| `RULES.md` | The school's decisions (money, attendance, marks, notes, roles, design rules). These win over design details |
| `DESIGN-SYSTEM.md` | Colour tokens (light/dark), type, spacing, responsive rule, motion keyframes, component list, icon map |
| `SCREENS.md` | Every module: suggested route, roles, what it covers, start states, frames, screenshot paths |
| `DATA-MODEL.md` | Data per screen and proposed additive tables |
| `screenshots/<page>/*.webp` | 341 frames (desktop 1440×900, phone 390×844) + `index.json` |
| `canvas-index.json` | Every frame → page, title, size, screenshot |
| `design/src/*.dc.html` | **Readable design sources**, one per module (template + `renderVals()` logic, sample data, copy) |
| `design/project/*.dc.html` | Built copies (CSS and icons inlined) + every frame wrapper + `canvas.json` |
| `design/shared/vx.css`, `icons.js` | The design system CSS and icon paths used by the sources |
| `design/specs/SPEC.md`, `SPEC2.md` | The briefs the modules were built from |
| `tools/render.js` | Renders any frame to static HTML for side-by-side comparison (`npm i htmlparser2` first) |

## Reading a `.dc.html` file
- `<x-dc>…</x-dc>` is the markup. `{{a.b}}` are values from `renderVals()`; `<sc-for list as>` loops; `<sc-if value>` shows or hides; `<dc-import name="XSide" …>` is a child component (the sidebar or the bottom bar).
- `data-props` lists the `start` states (each is a screen or state) and props like `role` and `dark`.
- `class Component` holds `data()` (sample data), `st()` (start state → state), the handlers (what each tap does, including toasts, Undo and sheets) and the computed view values. Treat it as the behaviour spec.

## Where the design lives online
The live design canvas, with Play mode to click through, is the "VPPS One Admin Layout" artifact on claude.ai. The Start here page lists every page.
