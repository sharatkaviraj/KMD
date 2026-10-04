# Pilot runbook — absence to cover, bounded

Prompt 8 asks for a small pilot runbook. This is it. It names the bounded
pilot this release is ready for, and how to stop it, recover it and roll it
back. **Nothing here authorizes a real WhatsApp send, a parent message or a
live-fee cutover;** each of those is a separate decision (CLAUDE.md rule 8).

## Scope

| | |
|---|---|
| **What** | Marking a teacher absent, arranging cover, telling the covering teacher **in the app** (Today and `/duty/[id]`), acknowledgement or "I cannot cover", and back at school |
| **Environment** | The production deployment, pointed at **schoolfees-dev** (`wtgxcptmucjerhufzjcf`). Live fee data is not reachable from this build (P0, D-208) |
| **App commit** | The `main` commit the release report names, deployed; confirm it on the Vercel deployment before starting |
| **Data** | The dev replica (de-identified, D-186), the eight-period bell default (D-211), the cover policies on dev (`cover_policies`) |
| **Participants** | One operator (the academic coordinator or an administrator), two or three teachers who agree to take part, one administrator on call |
| **Length** | One school week, on ordinary days |
| **Notices** | `STAFF_NOTICE_TRANSPORT` stays **mock** (dev) or **disabled** (live). Teachers learn of a duty from Today and the duty page, not WhatsApp |
| **Parents** | Untouched. `parent_dispatch` is off and every category needs approval (D-230) |

## Before the first day

1. On `/substitutions/rules` (administrator):
   - check both operator switches, **Saving absences and cover** and **Sending cover notices**,
     are visible;
   - check the bell schedule matches the school's day;
   - check the cover policy rows are the ones the school agreed.
2. Run `npm run verify:access`, `npm run verify:cover` and
   `npm run verify:outbox` against dev, and keep the output with the release
   report.
3. Give each participant their sign-in link (`npm run dev:login` is for QA
   accounts only; real staff sign in with their own account).
4. Tell the teachers the one thing that is new: a duty arrives on Today; open
   it and press **Seen**, or **I cannot cover** if they cannot.

## Each day

- The operator marks absences and arranges cover on `/substitutions`. Every
  save is one command with a receipt; a duty the plan cannot fill safely is
  shown as **needs help** (D-213), never as self study.
- Teachers open Today. The operator's board shows who acknowledged, who has not
  and who cannot.
- **"I cannot cover"** goes to the academic coordinators. The duty stays with
  that teacher until the operator reassigns it (D-215).

## Stopping it (no data is deleted)

| Problem | Switch | Effect |
|---|---|---|
| Cover commands misbehave | `/substitutions/rules` → **Saving absences and cover** off | New saves are refused with a message; committed duties, receipts and history stay readable |
| Notices misbehave | `/substitutions/rules` → **Sending cover notices** off | Nothing new is claimed for dispatch; queued notices wait; nothing is deleted |
| A notice may have gone wrongly | Leave **Sending cover notices** off | Unknown attempts are never retried by the machine; a person resends (D-214) |

## Recovering a wrong duty

Never by editing rows. Arrange again, or assign by hand. Each change is a new
revision, and a teacher who already saw the old one gets a "changed" or
"cancelled" notice in the app. Acknowledgements and earlier revisions stay.

## Rolling the app back

1. Turn both switches off.
2. In Vercel, **promote** the previous production deployment, chosen by commit
   sha (`vercel ls --prod` is not reliably newest-first).
3. The schema stays as it is: every migration this release added is additive,
   and the older app ignores the new tables.
4. Check that fee posting still works on dev for an accountant QA account. That
   is the fee module's own path; this release changed none of its functions
   (`npm run verify:fee-parity`).
5. Never restore an old database over later fee postings, and never truncate a
   table to make things look clean.

## Who to call

| | |
|---|---|
| Escalation owner | The administrator on call for the week (name them before day one) |
| Product decisions | Janmejay |
| A data question | Stop, turn the switch off, and keep the receipt id from the screen |

## What ends the pilot

The pilot ends after five days, or earlier if a switch had to be turned off
for a reason not understood within the day. Then:

- write what the teachers found into `docs/PROGRESS.md`;
- run `npm run verify:cover` again;
- decide, separately, whether real staff notices on WhatsApp are next. That
  needs the provider gate in Prompt 8: a named account, an approved campaign,
  a test recipient and a cost limit, each authorized.
