# Assessment fixes — 19 October 2026

Source: *VPPS One | Codex fix brief* (19 Oct 2026), built from the school-day
assessment of commit `2768ec5` (evidence cut-off 18 Oct 21:40 UTC). Branch
`fix/assessment-2026-10-19` → PR #102, merged on Raj's authorization as
`3348320` (all 23 checks green on head `52be936`) and deployed to production
(`vppsone.vercel.app`, deployment `dpl_9C4yJgBCtcVka7brtf2mV9Agm72a`). Follow-up
`fix/assessment-followup-2026-10-20` closes U03 and R01 hardening (below).

### Production smoke (20 Oct, read-only, QA magic links, nothing saved)

- Teacher: marks sheet Class 1 ELGA "19 / 39" with the old half marks flagged; Today "39 में से 19 पूरे".
- Admin: `/receipts/SVP20261019-0001?sheet=reverse` → replaced by the plain URL, no dialog, "Reversed on Mon 19 Oct, 2:02 am · by Raj".
- Admin Needs you: four "Leave asked" items with school dates ("Fri 16 October · Full day").
- Not checked on production: the leave sheet (the hidden browser pane could not draw it; verified locally on the same code).

## Baseline and boundaries

| Check | Result |
|---|---|
| Latest main | `2768ec5` — identical to the assessed build; working tree clean before work |
| Production deployment | `2768ec5` (GitHub deployment record, 18 Oct 19:32 UTC) |
| Open PRs | #97 (phone desk), #69 (draft), #30 (ImgBot) — untouched |
| Database identity | `get_project wtgxcptmucjerhufzjcf` → `schoolfees-dev`, ap-south-1, ACTIVE_HEALTHY. `.env.local` points at the same ref. The protected School Fees project `vgqyilgstjvgohrsiwkb` was never queried. |
| Migration ledger | The full recorded ledger was read (latest `20261018191452 overnight_qa_app_sessions`); **no migration applied, none written, none renamed**. Noted drift, not touched: repo files carry authoring timestamps (e.g. `20261016070000_teacher_tasks.sql`) where the ledger has the MCP's apply timestamps (`20261016125715`), and the ledger has `dev_fee_collector_posts_payments` (20261011093044) with no file in the repo. |
| Writes to DEV | None by code under test. Browser checks on a local server against DEV only read, opened sheets and previews, and pressed nothing that saves (no leave sent, no plan or note saved, no mark saved, no reversal, no payment). |
| Outbound | `.env.local` has no `AISENSY_*`, `MESSAGE_PROVIDER` or `STAFF_NOTICE_TRANSPORT`, so every real sender refuses and staff notices go to the mock. The photo acceptance harness aborts every non-loopback request and reported none. No message, payment, refund, bank attestation or queue sweep was made. |
| QA access | Passwordless magic links from `scripts/dev-login.mjs` to `@qa.vpps.local` accounts on `localhost:3200`. The revoked overnight launcher (`/qa/dayrun`, `/login/dayrun*`, `qa_dayrun_*` RPCs) was not opened or called; authentication was not weakened. |

## Finding ledger

Status words: **fixed** (reproduced or confirmed in source, changed, regression-tested); **fixed — verified live** (also seen working in a browser against DEV); **not a defect**; **open** (with the reason).

| ID | Status | Reproduction | Change | Evidence |
|---|---|---|---|---|
| B01 counts disagree | **fixed — verified live** | Four counting rules: Today counted every `marks` row (blank `value=null` rows too) over every `enrolled` row ignoring dates; the sheet counted local cells; the tracker used the paper roster. | One contract (`exams/domain/progress.ts`): eligible = paper roster; saved = value (zero counts), absent or exempt; blank stays blank. Today's `marksLinks` now goes through `trackerFor` and the same open-exam rule as the marks page. | `tests/vx-exams-progress.test.ts` (one fixture → identical numbers on all three; the old rule gave "8 of 7"). Live, Class 1 ELGA: Today "39 में से 19", sheet "19 / 39", exam tracker "19 of 39". |
| B02 local edits look saved | **fixed** | `counts(order, cells)` included unsaved and blocked edits. | Progress counts what the server saved; "N change(s) on this device" apart; "Saving… / Saved just now / Not saved – your change is still here · <pupil>: <reason>" with Retry; `aria-live`. An older-revision draft is shown, never restored. | `marks-mobile` Playwright 14/14 (360/390/412 + landscape); `tests/vx-exams-progress.test.ts`. |
| B03 old fractions block a valid edit | **fixed — verified live** | DEV has 12+ open/submitted Half-yearly papers on whole-mark (`mark_step 1`) papers holding 16–24 half marks each (replica data); `save_marks` validated every sent cell and the sheet sent the whole column. | Drafts and corrections send and validate only changed cells; the saved snapshot merges. Old invalid marks are flagged inline ("Needs correction: 61.5 — this paper takes whole marks"), never rounded or rewritten. Final submit still checks the whole column — now **on the server** too (`submitBlocker` in `marks-save.ts`, also wired into the old `/assessments` form). | Unit: legacy 7.5 + new integer → payload has only the changed row; submit blocked naming the pupil; 7.5 byte-identical. `tests/assessment-review-fixes.test.ts`. Live: Class 1 ELGA sheet lists its 7 legacy marks by pupil and value. |
| B04 readiness vs tracker | **fixed — verified live** | "Checked" = all submitted and no unusual average; "Ready to lock" = all submitted; lock checked only `entry_status`. | Missing marks / Needs correction / Saved, not submitted / Submitted / Ready for review; "Ready to lock" only when every paper is submitted, complete and valid. `lockClassesAction` refuses on the server with the exact reason. "Normal" relabelled "Average normal". Tracker says "Marks being entered (N of M saved)". | `tests/vx-exams-progress.test.ts` (`lockRefusal`). Live: results board "Checked 0 of 19", per-class statuses; tracker cell "Marks being entered (19 of 39 saved)". No class was locked. |
| B05 receipt heading, Undo | **fixed** | Heading from `currentExam()` not the paper's exam; Undo shown regardless of expiry (server already refused after 10 min). | Paper's own exam; server-computed undo window and remaining time, counted down on the phone's own clock; Undo only for the submitter in the window; afterwards "Submitted on …"; a late click shows the server's refusal and changes nothing. Office opens marks read-only with "Edit marks" as a deliberate step. | `marks-mobile` suite; `tests/vx-exams-*`. |
| B06 remarks | **fixed** | No write-own field when suggestions exist; a suggestion tap saved bilingual text at once. | "Write my own" always available; a suggestion previews without saving; Draft/Saving/Saved status; Remove draft; one save when blur and Save coincide. | Unit suites; not driven live (would write a remark). |
| B07 stale balance after payment | **fixed** | Root cause: the settle read drained the matview refresh, but the drain returns false under `skip locked` when the fee action's own drain holds it, and the refresh is concurrent — the read saw the pre-payment snapshot. The ledger arithmetic was right. | Post-payment balance comes from the live ledger (`getPaymentDateAwareInstallmentBalances`) with `balanceSource: "live"` and `readAt`; an empty live read is believed only when the receipt's own "still owed" is zero; paise kept exactly. Receipt shows "At this receipt · fees still owed" (immutable) apart from "Balance now · read at …". "Payment recorded. Updating balance…" → "Receipt saved. Balance could not refresh." + Retry, which re-reads only, for the posted child. | `tests/payment-live-balance.test.ts` (₹7,100 view + ₹7,099 live → ₹7,099; cleared → 0), `tests/payment-parity-flow.test.tsx` (delayed settle, failed settle, Retry never posts, double-click posts once). No payment posted on DEV. |
| B08 reversal URL/history | **fixed — verified live** | `?sheet=reverse` opened the sheet on a reversed receipt ("Reverse ₹0"); decided desk requests vanished from My requests. | Sheet gated on authoritative state; a URL asking for a sheet the page won't open is replaced; "Reversed on <day, time> · by <name>"; reversal time no longer 5.5 h off; My requests includes decided `fee_desk_requests`. The admin who decides a waiting request still opens the sheet. The server's already-reversed guard and append-only adjustments are unchanged. | `tests/receipts-reverse-sheet.test.tsx`, `tests/books-desk-requests.test.ts`. Live: `/receipts/SVP20261019-0001?sheet=reverse` → replaced by the plain URL, no dialog, "Reversed on Mon 19 Oct, 2:02 am · by Raj". |
| B09 week count, "you" | **fixed** | Notes bucketed by the UTC date of `createdAt` (a Monday 00:00–05:29 IST note fell into last week); "you" decided by role. | `noteSchoolDay()` (IST, shared `platform/dates`); "you" by actor id (follow-up owner, saved-note readers, plan step owners). | `tests/vx-notes.test.ts` (19:45 UTC Sunday = Monday IST, month edge). |
| B10 class context | **fixed — verified live** | Class 2 shortcut opened the picker on Class 1. | `?class=` carried into the composer; picker starts on it; an unknown class falls back to the list, never another child. | Live: `/teach/notes?sheet=add&class=<Class 2>` opens on Class 2. |
| B11 half-day preview | **fixed — verified live** | Today listed every remaining period ignoring the half; More halved the bell list; approval used `spanPeriods`; More sent multi-day halves as full while saying "First half". | One resolver `leavePeriods()` (+ `leaveSpanFor`) used by a read-only `previewLeaveVx` for both forms, matching the approval's `spanPeriods`; multi-day halves say they go as full days. One-period leave: **not supported** (schema check allows full/first/second half only) — not broadened. My leave shows "Approved/Declined by <name> · <time>". | `tests/leave-and-register-clarity.test.ts`. Live: both forms "Mon 19 Oct · पहली पाली – पीरियड 1, 2, 3, 4 … ऑफ़िस इन 4 पीरियड का इंतज़ाम करेगा"; teacher2 "Declined by Raj · Mon 19 Oct 2:03 am". No leave sent. |
| B12 workload units | **fixed** | 92 = planned `periods_per_week` per class-subject; 44 = unique timetable slots. | The planned figure is labelled "Planned: N class-periods a week"; "periods a week" keeps meaning timetable slots everywhere. | Source. |
| B13 dated notices/tasks | **partly fixed** | Notice cards already show the sent date; the ambiguity is in stored free text ("आज 3 बजे" in a 15 Oct test notice). Task titles were a bare ISO date or "6 · SCI"; Needs you leave showed "2026-10-16". | Task titles "Attendance · 19 October", "Marks · …", "Due 19 October"; Needs you leave uses school dates. Stored notice bodies are not rewritten. | Live: Needs you leave rows re-checked after the fix. **Open:** an "applies on" date for notices is a new field — proposal only. |
| B14 attendance banner | **fixed** | Banner was fixed text whatever was marked. | Follows live counts: "Marked so far: 27 present, 1 absent." / not saved yet. | `tests/leave-and-register-clarity.test.ts`. |
| B15 clipping/overlap | **fixed for the notes board** | Tag filter was a hidden-scrollbar strip. | Tags wrap. | Live at 500 px: tag row wraps (82 px, not clipped), page `scrollWidth` = 500, "Add a note" overlaps no card at the end. **Not reproduced elsewhere:** the original screen of the overlap was not named; other admin screens were not swept at 500 px. |
| B16 completion | **fixed (attendance)** | Saved attendance had no next step. | "Back to Today" on the saved card; marks already had Next/Back. | Source. |
| R01 private note → plan | **fixed (app layer); policy hardened in follow-up** | Confirmed in source, **not** an observed exposure: the teacher plan screen silently set `goal = excerpt(note.body, 120)`; `createPlanAction` never checked the source note; plan readers ignored private sources. DEV audit: 2 private notes, 0 plans from them, 0 goals containing private text. | Only-me source → empty goal, readers shown before saving, "Use words from the note" is a separate previewed action; server checks the source note via `visibleNotes` (readable, same child, same session, author), refuses private words unless deliberately shared, never queues an Only-me plan for parents; plans whose goal still repeats private words, or whose private source is health/family, are their author's alone on every read path (board, `?plan=`, coordinator `planFor`), and a coordinator cannot overwrite a plan hidden from them. | `tests/notes-plan-source.test.ts` (8 cases: other teacher's note refused with no write, copied words refused, deliberate share allowed, parents refused, other child refused), `tests/vx-notes.test.ts`. Live: the teacher's Only-me note opens the plan with an empty goal, "यह योजना कौन देखेगा: …", and the preview button. |
| U01 report card | **not a defect (arithmetic); loading bounded** | Full preview loaded in ~2.1 s locally (warm). One pupil: 175/300 shown 56.2%. | Link passes `exam`/`class`; `/exams` has a loading skeleton and error boundary with Retry; "Weighted by exam" shown when weights differ; PDF cards built four at a time; arithmetic unchanged. | Reconciled from raw DEV marks: subjects sum the term's 20-mark formative + 80-mark half-yearly; half-yearly weight 2; absent = 0 of 80; Σv·w = 303.5, Σmax·w = 540 → 56.2%. Rule documented in `tests/assessments-domain.test.ts`. The 262.5/380 → 70.8% sample is explained by the same weighting. |
| U02 lesson log/closeout | **not present — proposal only** | No lesson, syllabus or closeout routes or tables exist; "day close" is fees only. | None (out of scope for a fixes release). | — |
| U03 photo loop | **fixed — verified on DEV (follow-up)** | Code: ownership, scope, session, file type/size, duplicate submit and "official photo unchanged until approval" are enforced in app and SQL. Gaps: a rejection carries **no reason** (no column), ends the round, and counts the task complete. | Follow-up: `photo_proposals.decision_note` and a 4-argument `review_student_photo` (DEV migration `20261020020824`); the admin sends a photograph back only with a reason; the teacher reads "Changes requested: <reason>"; the task pill says "Changes requested". A new round is still started by the office. | `tests/profile-photos/acceptance.mjs` passed at 1440/390 px with no external requests. `tests/photo-review-reason.test.ts`. Live two-role loop against DEV's real functions, in one transaction forced to roll back (counts 0/0/1 before and after): submit ok; duplicate submit replayed; official photo unchanged while pending; teacher review → `photos:admin_required`; wrong link → `photos:not_permitted`; reject stores "Face is not clear (synthetic)" and submission `rejected`; resubmit same round → `photos:decided`; new round approved through the old 3-argument call places the photo. Not driven through the browser (the built-in browser cannot upload a file). |
| U04 phone/accessibility | **partly** | — | Live-region save statuses, labelled inputs on new controls. | `marks-mobile` 14/14; `payment-ui` Chromium 15/15 (WebKit 15 not run — the WebKit browser is not installed on this laptop; CI runs it); `mobile-ui` 124/124 (320–1440 px, light/dark, reduced motion). Not done: 200 % text zoom, physical touch devices, keyboard-only pass. |
| U05 advanced flows | **partly** | — | — | Covered by unit/Playwright harnesses: stale tabs (old-revision draft), lost response + same command, double submit, repeated reversal guard (server unchanged). Not run live: concurrent editors on DEV, network loss on a real phone, final lock. |

## Proposals that need approval (nothing applied)

**R01 defence in depth — applied in the follow-up as DEV migration
`20261020020829_support_plans_follow_source_note`.** No app code reads plans
through a user's client, so the screens are unaffected. Verified with real
roles in a rolled-back transaction: the author teacher sees her plan from an
Only me note; the academic coordinator, the admin and teacher2 do not; a plan
with no source note stays visible to the school-wide roles.

Original proposal text: The app reads plans with the
service role, so the app-layer checks above are the boundary in the app. The
browser client could still read `support_plans` directly over REST under
`support_plans_select_scoped` (`notes:view` and `reads_every_class() or
created_by = me`). Bounded change, with rollback being the current `using`
clause:

```sql
alter policy support_plans_select_scoped on vppsone.support_plans
  using ((select vppsone.staff_can('notes:view')) and (
    created_by = (select vppsone.current_staff_profile_id())
    or ((select vppsone.reads_every_class())
        and (note_id is null or exists (select 1 from vppsone.notes n where n.id = support_plans.note_id)))));
```

Trade-off: it also hides plans made from Only-me notes from coordinators even
after their goal was rewritten. Needs Raj's decision; not applied.

**U03 rejection reason — applied in the follow-up (`20261020020824`).** Add `decision_note text` to `vppsone.photo_proposals`,
pass it through `review_student_photo`, show "Changes requested: <reason>" to
the teacher and let a rejected child be sent again in the same round. Additive
DEV migration + function replacement; needs approval before it is written.

**B13 notice date.** An optional "applies on" date on staff notices so a body
saying "today" is read against the right day.

## Rollback

Code only: revert the two commits (`git revert 2bb22a3 f73c48a`) or redeploy
`2768ec5`. No schema, grant, policy, credential or data change was made, so
there is nothing to undo in DEV.
