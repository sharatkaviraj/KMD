# DESIGN-SYSTEM — tokens, type, motion, components, layout

Source of truth: `design/shared/vx.css` (tokens + components + keyframes), `design/shared/icons.js` (icon paths).
Port these into the repo's styling setup (CSS variables + Tailwind theme, or CSS modules). Keep the names, so that
the design files and the code use the same words.

## 1. Colour tokens (light → dark)
Set them on the app root; dark mode = `.dark` class on the root (and follow `prefers-color-scheme` when the user picks Auto).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F4F7FA` | `#0E1117` | page background |
| `--card` | `#FFFFFF` | `#161A22` | cards, sheets |
| `--s2` | `#F0F6F9` | `#1C212B` | subtle fill, hover |
| `--s3` | `#E3EDF2` | `#262C37` | track / segmented bg |
| `--fg` | `#151923` | `#F3F1EC` | text |
| `--mut` | `#5C6270` | `#B3AFA4` | secondary text |
| `--sub` | `#8A8E98` | `#8E8A80` | placeholder / faint |
| `--bd` | `#DCE4EA` | `#2A303B` | borders |
| `--bds` | `#ACC0CD` | `#3B4250` | strong borders, inputs |
| `--pri` | `#0B4F79` | `#81DAE4` | primary buttons, active |
| `--prifg` | `#FFFFFF` | `#08202A` | text on primary |
| `--acc` | `#0E717C` | `#81DAE4` | accent, focus ring, links |
| `--accs` | `#E6F6F7` | `#123139` | accent soft fill |
| `--accfg` | `#0B5C65` | `#A9E9F0` | text on accent soft |
| `--nav` | `#082F49` | `#0A1824` | sidebar background |
| `--navs` | `#153C56` | `#132D40` | sidebar active pill |
| `--navb` | `#24465E` | `#21425A` | sidebar borders |
| `--navm` | `#AFC0CC` | `(same)` | sidebar muted text |
| `--navfg` | `#F7F6F3` | `(same)` | sidebar text |
| `--ok` | `#1B5F3E` | `#5FCB97` | success / present |
| `--oks` | `#E9F8F0` | `#122A22` | success soft |
| `--okm` | `#CDEFDD` | `#1D4A37` | success mid |
| `--warn` | `#A95C0F` | `#F2A85A` | warning / half-day |
| `--warns` | `#FEF5E7` | `#2E2318` | warning soft |
| `--warnfg` | `#83470B` | `#F6C88F` | text on warning soft |
| `--warnm` | `#F6D9A8` | `#5B3F1E` | warning mid |
| `--bad` | `#B41D1D` | `#F27E7E` | danger / absent / overdue |
| `--bads` | `#FDEEEE` | `#33191C` | danger soft |
| `--info` | `#1D48A5` | `#8FB0F5` | info |
| `--infos` | `#EEF3FE` | `#18213A` | info soft |
| `--c1` | `#0B4F79` | `#81DAE4` | chart 1 (UPI) |
| `--c2` | `#2A9DA8` | `#3E9AA6` | chart 2 (cash) |
| `--c3` | `#E0A042` | `#F2A85A` | chart 3 (cheque) |
| `--c4` | `#A9BCC9` | `#6E7F8C` | chart 4 (bank) |
| `--heat` | `14,113,124` | `129,218,228` | heat-map RGB |
| `--glass` | `rgba(244,247,250,.86)` | `rgba(14,17,23,.84)` | frosted top bar |
| `--glass2` | `rgba(255,255,255,.9)` | `rgba(22,26,34,.9)` | frosted bottom bar |
| `--scrim` | `rgba(8,20,30,.45)` | `rgba(0,0,0,.55)` | sheet backdrop |
| `--wabg` | `#ECE5DD` | `#0B141A` | WhatsApp chat bg |
| `--wab` | `#DCF8C6` | `#005C4B` | WhatsApp bubble |
| `--wafg` | `#111B21` | `#E9EDEF` | WhatsApp text |
| `--sh` | `0 1px 2px rgba(21,25,35,.04),0 12px 28px -18px rgba(21,25,35,.28)` | `0 1px 2px rgba(0,0,0,.4),0 12px 28px -18px rgba(0,0,0,.7)` | card shadow |
| `--shh` | `0 2px 4px rgba(21,25,35,.05),0 20px 40px -18px rgba(21,25,35,.36)` | `0 2px 4px rgba(0,0,0,.4),0 20px 40px -18px rgba(0,0,0,.8)` | hover shadow |
| `--shl` | `0 30px 80px -24px rgba(8,20,30,.5)` | `0 30px 80px -24px rgba(0,0,0,.85)` | sheet/toast shadow |
| `--onsolid` | `#FFFFFF` | `#10131A` | text on solid colours |
| `--tbg` | `#151923` | `#F3F1EC` | toast bg |
| `--tfg` | `#F7F6F3` | `#151923` | toast text |
| `--tacc` | `#81DAE4` | `#0B5C65` | toast action |
| `--tacs` | `rgba(129,218,228,.16)` | `rgba(11,92,101,.12)` | toast action bg |
| `--ease` | `cubic-bezier(.22,1,.36,1)` | `(same)` | standard easing |
| `--spring` | `cubic-bezier(.34,1.36,.64,1)` | `(same)` | springy easing |

## 2. Type, spacing and shape
- **Fonts:**
  - **Inter** (UI, weights 400/500/600/700, tabular numbers for money via `font-variant-numeric: tabular-nums`);
  - **Source Serif 4** (page titles and big headings, 600);
  - **Noto Sans Devanagari** (Hindi; put it in the font stack right after Inter).
  Load them with `next/font` and `display: swap`.
- **Base size:** 14 px on desktop and 15–16 px on phone (inputs 16 px so iOS doesn't zoom); teacher screens use 16 px. Section labels are 12 px, bold, uppercase, with 0.06em letter spacing.
- **Radius:** cards 18, sheets 28 (phone) / 22 (dialog), buttons 12, chips 17 (pill), inputs 12.
- **Heights:** buttons 40 (desktop) / 44+ (phone; teachers 52), chips 34 / 38, inputs 44, list rows ≥ 56.
- **Layout:**
  - desktop sidebar 248 px (`--nav`); glass top bar 64 px; content padding 22–28 px;
  - phone top bar 58 px; bottom bar 76 px with a centre action button (50 px, radius 18).

## 3. Responsive rule (one tree, two layouts)
- The page root is a **container** (`container: vx / inline-size`). **≥ 900 px** of container width = desktop layout; **< 900 px** = phone layout.
- Helpers from the design:
  - `.only-d` / `.only-m` and `.hide-m` / `.hide-d`;
  - `.g4` (4 → 2 columns), `.g3` / `.g2` / `.stack` (→ 1 column), `.pad` (16 px gutters on phone);
  - `.unstick` (a sticky side panel becomes normal flow on phone), `.mfull`.
- **Sheet:** a bottom sheet on phone (with a grab handle, slides up); a centred dialog on desktop (580 px, or 760 px for `.wide`, scales in).
- **Toast:** at the bottom, above the bottom bar on phone; Undo is a button inside it.
- **Lists:** a grid table on desktop and a card list on phone, built from one column definition.

## 4. Motion (transform and opacity only; respect `prefers-reduced-motion`)
Easing: `--ease: cubic-bezier(.22,1,.36,1)`; `--spring: cubic-bezier(.34,1.36,.64,1)`.

| Keyframe | Use | Typical |
|---|---|---|
| `xIn` | list rows fade up (staggered 0–400 ms) | .32s ease |
| `xRise` | KPI cards / sections rising | .42s ease |
| `xFade` / `xOut` | scrims, swaps | .25s / .22s |
| `xPush` / `xPop` | go deeper / go back (screen change) | .36s / .32s |
| `xUp` / `xDown` | bottom sheet open / close | .42s / .24s |
| `xModal` / `xModalOut` | desktop dialog open / close | .30s / .20s |
| `xMenu` | dropdown / popover | .2s |
| `xGrowY` / `xGrowX` | bar charts, progress (set transform-origin) | .5–.7s |
| `xDraw` | SVG stroke drawing: rings, sparklines, success tick (set `--len` + `stroke-dasharray`) | .45–.7s |
| `xPopIn` / `xTick` | badges, stamps, ticks | .45–.5s spring |
| `xPulse` | live dot / "do this now" | 2s infinite |
| `xLoop` / `xSpin` | spinner | .8s linear infinite |
| `xToast` | toast in | .32s spring |
| `xShimmer` | skeleton | 1.4s infinite |
| `xShake` | invalid input | .4s |
| `xLeave` | row leaving a list (done / archived) | .45s |
| `xWave` / `xRipple` / `xCaret` | voice note: waveform bars, mic ripples, typing caret | .9s / 1.6s / 1s infinite |

Transitions: progress widths `.5s var(--ease)`; switch knobs and segmented thumbs `transform .32s var(--spring)`; colours `.2s`.
Where the browser supports it, use the View Transitions API for page push/pop.

## 5. Components to build (from the design's classes and patterns)
| Component | Design source | Notes |
|---|---|---|
| AppShell / Sidebar / TopBar / BottomBar | `XSide.dc.html`, `XNav.dc.html`, every module's header | role prop; nav from `lib/nav.ts`; badges; Hindi sub-labels for teachers |
| Card, Section label (`sech`), Pill | `.card`, `.sech`, `.pill` | |
| Button | `.btn` + `.pri` `.sec` `.soft` `.ghost` `.danger` | press scale .97; teacher size 52 px |
| Chip / ChipRow | `.chip(.on)`, `.hs` scroller | filters, helper chips |
| SegmentedControl | `.seg` + `.thumb` | sliding thumb |
| Switch | `.sw(.on)` | `role="switch"` |
| RadioCard | reverse reasons, outcomes | `role="radio"` |
| Field / Input / Textarea | `.field`, `.inp(.err)` | error shake + plain message |
| Stepper (+/−), NumberPad | day close denominations; marks keypad | |
| Wizard progress | Admissions, Reminders | sticky Back/Next footer |
| Sheet (bottom sheet ⇄ dialog), Scrim | `.sheet`, `.scrim` | closing animation before unmount |
| Toast with Undo | `.toast` | 4.5 s; Undo calls a server reversal |
| KPI tile, Ring, Sparkline, StackedBar, BarChart, HeatGrid, Donut | Today, Reports, Progress | draw/grow animations |
| DataList (table ⇄ cards) | Fees, Dues, Staff, Students | one column definition |
| EmptyState, Skeleton, SuccessTick | everywhere | |
| WhatsAppPreview | Reminders, Messages, receipts | `--wabg` / `--wab` / `--wafg`; Hindi first; count + cost |
| VoiceNote widget | TchNotes, Notes | Web Speech API + keyboard fallback |
| HelpSheet ("?") and LangSwitch (EN · हि) | teacher and role apps | |
| Money | everywhere | `₹1,23,400`; tabular numbers; negative as `−₹` |
| Receipt card (bilingual) | Fees, PayDesk | amount in words (Indian system) |

## 6. Icons
The design uses Lucide-style single-path icons (`design/shared/icons.js`, plus a few defined inline in modules). Use `lucide-react`:

| Design `IC.name` | lucide-react |
|---|---|
| `search` | `Search` |
| `chevRight` | `ChevronRight` |
| `chevLeft` | `ChevronLeft` |
| `chevDown` | `ChevronDown` |
| `chevUp` | `ChevronUp` |
| `arrowUp` | `ArrowUp` |
| `arrowRight` | `ArrowRight` |
| `x` | `X` |
| `plus` | `Plus` |
| `minus` | `Minus` |
| `check` | `Check` |
| `checkCircle` | `CircleCheck` |
| `home` | `House` |
| `users` | `Users` |
| `user` | `User` |
| `userPlus` | `UserPlus` |
| `inbox` | `Inbox` |
| `grid` | `LayoutGrid` |
| `rupee` | `IndianRupee` |
| `receipt` | `FileText (or Receipt)` |
| `calCheck` | `CalendarCheck` |
| `calendar` | `Calendar` |
| `clock` | `Clock` |
| `swap` | `ArrowLeftRight` |
| `phone` | `Phone` |
| `message` | `MessageCircle` |
| `megaphone` | `Megaphone` |
| `send` | `Send` |
| `bell` | `Bell` |
| `edit` | `PenLine` |
| `trash` | `Trash2` |
| `more` | `Ellipsis` |
| `alert` | `TriangleAlert` |
| `info` | `Info` |
| `help` | `CircleHelp` |
| `shield` | `Shield` |
| `lock` | `Lock` |
| `key` | `Key` |
| `eye` | `Eye` |
| `eyeOff` | `EyeOff` |
| `mail` | `Mail` |
| `printer` | `Printer` |
| `download` | `Download` |
| `upload` | `Upload` |
| `file` | `File` |
| `copy` | `Copy` |
| `link` | `Link` |
| `image` | `Image` |
| `filter` | `Filter` |
| `sliders` | `SlidersVertical` |
| `settings` | `Settings` |
| `chart` | `ChartColumn` |
| `pie` | `ChartPie` |
| `trend` | `TrendingUp` |
| `bus` | `Bus` |
| `book` | `BookOpen` |
| `grad` | `GraduationCap` |
| `clipboard` | `ClipboardList` |
| `archive` | `Archive` |
| `database` | `Database` |
| `activity` | `Activity` |
| `globe` | `Globe` |
| `moon` | `Moon` |
| `sun` | `Sun` |
| `logout` | `LogOut` |
| `undo` | `Undo2` |
| `refresh` | `RefreshCw` |
| `cloud` | `Cloud` |
| `wifiOff` | `WifiOff` |
| `layers` | `Layers` |
| `list` | `List` |
| `table` | `Table` |
| `zap` | `Zap` |
| `award` | `Award` |
| `percent` | `Percent` |
| `tag` | `Tag` |
| `mapPin` | `MapPin` |
| `briefcase` | `Briefcase` |
| `star` | `Star` |
| `flag` | `Flag` |
| `hash` | `Hash` |
| `pin` | `Pin` |
| `del` | `Delete` |
| `mic` | `Mic` |
| `note` | `NotebookPen` |
| `cake` | `Cake` |
| `bank` | `Landmark` |
| `ticks` | `CheckCheck` |
| `door` | `DoorOpen` |
| `camera` | `Camera` |
| `history` | `History` |
| `gift` | `Gift` |
| `building` | `Building2` |
| `text` | `Type` |
| `type` | `Type` |
| `flask` | `FlaskConical` |
| `coffee` | `Coffee` |
| `heart` | `Heart` |
| `smile` | `Smile` |
| `keyboard` | `Keyboard` |
| `calMinus` | `CalendarMinus` |

## 7. Accessibility
- Every button has `type="button"`, and icon-only buttons have an `aria-label`.
- Toggles use `role="switch"` + `aria-checked`; choices use `role="radio"`; chips use `aria-pressed`.
- Visible focus ring: `2px solid var(--acc)`, offset 2.
- Live amounts use `aria-live="polite"`.
- Contrast: tokens are tuned for AA. Don't put `--mut` on `--s3`.
