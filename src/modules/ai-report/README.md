# AI report

One file with everything One and Fees hold for a session, to give to an AI assistant.

Reports → AI report (`/reports/ai`, owner, 7 Nov 2026, D-482/D-483): staff
give the file to ChatGPT (or any assistant that reads Excel) and ask for
whatever report they need. It replaces hunting through many separate reports.

## What the file is

- **One workbook.** One's sheets first (`_README`, `_SHEETS`, `Students`, then
  every sheet in `domain/sheets.ts`), then every sheet of Fees' own "AI context
  bundle" under a `Fees ` name (`_README` becomes `Fees README`).
- **With photographs, a .zip**: the workbook, `photos/<SR no> - <Name> (<Class>).jpg`,
  `photos/index.csv`, and `READ-ME-FIRST.txt` (what is inside, how to use it,
  example questions, keep it private).

## Why it is built in the browser

Every response must stay under Vercel's 4.5 MB. So the server sends parts and
the page joins them (`domain/bundle.ts`, SheetJS + fflate):

| Route | Part | Limit |
|---|---|---|
| `/api/reports/ai/school` | One's records as one workbook | 4.3 MB, else `too_large` |
| `/api/reports/ai/fees` | Fees' AI context workbook (bridge) or One's TEST copy | 4.3 MB |
| `/api/reports/ai/photos?after=` | 40 photographs (≈2 MB) a page, from Fees | one page |

If the two workbooks cannot be joined on the device, the .zip carries them as
two files and the read-me says so.

## Who gets what

- `reports:ai` opens the page and every route. It is the admin's alone until
  Staff → Roles grants it (migration `20261107045006`).
- Each One sheet also needs the permission that shows the same records on
  screen, **and** a school-wide role (admin, office, coordinators), except One's
  fee follow-ups and notes (`sheetAllowed`). Notes go through `canSeeNote`, the
  notes screen's own rule: private notes are their writer's, health and family
  notes the admin's and the class teacher's.
- The Fees half needs `fees:reports`; for real staff on a real year Fees checks
  its own grants again (reports, students, finance). A real year without the
  live connection gets **no** money sheets, never One's copy of them.
- Photographs need `students:view` and come only from Fees, for a real year.
- `canAccessSession` as everywhere: test accounts get rehearsal years only.

## Never

- Never put a secret, link, storage path, hash or raw id in a sheet: the
  `NEVER` list and the id rule in `shapeRow` keep them out generically, so a new
  column cannot leak one.
- Never let One's fee copy stand in for Fees' money on a real year.
- Never return an error's own text: `aiReportFailure` answers in fixed words.
- Every download is logged in `academic_exports` (kind `ai_report`): who, which
  year, which part, how many rows.
