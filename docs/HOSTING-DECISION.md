# Hosting decision — inputs, measured 4 October 2026

P12 asks for the inputs to a hosting decision, not the decision. This page
records what was measured on the current build and dev data, and what the
decision still needs. It does **not** recommend an upgrade, a migration or a
provider. Plan §18's caution stands: figures are planning inputs, not offers or
the school's invoice.

## What runs today

| | |
|---|---|
| App | Next.js 16 on Vercel, one project (`vppsone`), `runtime = nodejs` throughout |
| Screens | 105 pages, 45 route handlers (including the ported School Fees screens) |
| Scheduled jobs | 5 daily Vercel crons: open registers 01:45 UTC, staff notices 02:00, attendance reminder 04:00, missing-marks nudge (Sundays 11:30), daily summary 13:00. Daily crons fire up to an hour late, and every job is written to be safe if it does. `auto-day-close` is **not** here; it runs in the fee app's deployment only (CLAUDE.md) |
| Database | Supabase, one project per environment. This build reads schoolfees-dev only; live is the fee app's (D-208) |
| Storage | Private buckets: `vppsone-documents`, `vppsone-photos` (P10c), `vppsone-archives` (P11) |
| Message provider | None configured here. Staff notices are mock on dev and disabled on live; parent dispatch is off |

## Measured on dev (the de-identified replica, D-186)

| Measure | Value |
|---|---|
| Whole database | 58 MB |
| `vppsone` schema (this app's tables and indexes) | 6.7 MB, 66 tables, 4,530 rows in the last archive |
| `public` schema (the fee app's) | 19 MB |
| Documents and photographs | 4 objects, under 1 KB (dev holds only test files) |
| One full archive (every table and object) | about 2 MB, about a minute to build and drill on dev |
| Accounts | 23 auth users (QA accounts and staff) |
| Heaviest first-load page JavaScript | `/fees/transactions` 173 KB gzip; `/students` 134.6 KB; every measured route inside its budget |

**Not measured here:** Vercel function invocations, bandwidth and build minutes
for a month; Supabase egress; live data volumes (live is not read). Take these
from the Vercel and Supabase usage pages after a pilot month, by the person
holding those accounts. This work had no billing access and asked for none.

## What will grow

- **Photographs** are the only large thing. At 800 px JPEG, about 60–120 KB
  each, roughly 600 children is 40–70 MB a year, and kept replacements add to
  that. Each archive copies them again.
- **Archives** grow with photographs: a year-end archive with every photograph
  is roughly the photo total plus a few MB of tables.
- **Tables** grow slowly: registers, marks, messages and history add thousands
  of rows a year, megabytes not gigabytes.

## The cost formula (plan §18), unchanged

Monthly cost = app-host subscription and measured overage + database
subscription, storage and egress + scheduler and worker usage + AiSensy
subscription + message-category charges and provider additions + private
archive storage + applicable tax.

Do not convert USD with a guessed exchange rate. The plan's illustration was
one Vercel deploying seat plus one full-month Supabase Micro project, at about
**$45/month** before taxes, currency conversion, WhatsApp, domains, archive
storage and operations. That illustration is the plan's, not a measurement, and
not a recommendation.

## Decisions this needs, and who owns them

1. **One app or two at cutover.** School Fees still runs at its own deployment
   (CLAUDE.md). Retiring it changes the Vercel project count, not the database
   count. The fee module's owner decides.
2. **Off-site archive destination.** Manual Drive copies today
   (`docs/ARCHIVE.md`); automating them needs the school's authorization and a
   named owner.
3. **WhatsApp provider and budget.** Separate gate (Prompt 8 provider
   verification): account, campaign, recipients and a cost limit, each
   authorized.
4. **Supabase plan for live** once VPPS One writes there: backups, point-in-time
   recovery and Storage limits, read from the account by its holder.
