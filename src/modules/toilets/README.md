# Toilets

Toilet checks (`/toilets`, owner, 17 Nov 2026, D-652): every toilet is checked
twice a day on a printed weekly chart, the filled chart is photographed and
uploaded to One, and what never came in is shown first.

## How it runs

1. On Monday the office prints each toilet's chart (`/toilets/chart`): one A4
   landscape sheet, Monday to Saturday, a morning and an afternoon row for each
   open day, a tick box for every line of the check list, Time, Remarks and
   Name & sign. Closed days (the school calendar) are shaded. A QR code opens
   the upload for exactly that toilet and week.
2. The checker ticks it twice a day.
3. After Saturday someone photographs it and uploads it. They tap only the
   checks left empty on the paper (all are counted as done otherwise).
4. Needs you (admin and office) shows one card while any chart in the last
   eight weeks is due today or not uploaded, or last week's chart came back with
   missed checks.

## Files

- `domain/checks.ts`: pure rules. Weeks (Monday to Saturday; a Sunday belongs
  to the week just over), the state of each toilet's chart for a week (done,
  being filled, upload today, late, closed, not on the list), the gaps, and the
  checks for a toilet, the times and check list, and a missed list.
- `data/read.ts`: one session's toilets, settings and stored charts, service
  role after the caller's permission check; `{ ready: false }` while the tables
  are missing. `toiletGaps()` is the Needs you count.
- `data/writes.ts`: the only writes; every statement names the session.
  `beginChart` makes the chart row (the phone's own id, so a retry is the same
  chart) and signs one upload link per page; `finishChart` checks every page is
  a JPEG of a sane size and calls `vppsone.toilet_chart_store`, which makes it
  the week's chart and sets an older one aside. Nothing is ever deleted.
- `ui/chart-pdf.tsx`: the printed chart.

Photos live on the private `toilet-charts` bucket and are read only through
`/toilets/photo/[chartId]/[page]` (`toilets:view`, this session, `no-store`).
The screen is `src/vx/screens/toilets/`; the page, server actions and routes are
`src/app/(app)/toilets/`.

## Never

- Never a write without the action's permission (`toilets:upload` to send a
  chart, `toilets:manage` for the list, the times and taking a photo off), the
  "see the app as" refusal and the session fence.
- Never a public photo URL: the bucket refuses every client role.
- Never delete a chart or a toilet: removing sets `removed_at`, a re-upload sets
  `replaced_at` on the old chart.
