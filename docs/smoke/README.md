# Smoke Lab — AI agents run the school day

Passwordless test accounts for every role, so AI agents can use VPPS One
end to end on the **test database** and file the bugs and improvements they
find. Asked for by the owner on 20 Oct 2026 (D-311–D-313).

It works only while the app points at the test database
(`wtgxcptmucjerhufzjcf`) and is not declared live. On live, `/smoke` 404s,
passes are refused and smoke accounts are signed out — no code change needed.

## The pieces

| Piece | Where |
|---|---|
| 28 test accounts: admin, office, accountant, 2 fee collectors, academic and exam coordinators, view-only, and 20 teachers — 16 attached to real class-teacher profiles, 2 to subject teachers with no class, and 2 brand-new teachers with nothing assigned | `npm run smoke:pool` (`scripts/smoke-pool.mjs`; `status`, `release`) |
| A ready plan: all 28 seats with personas, in ten waves of at most three browsers | `docs/smoke/plans/school-day.json` (no secrets; checked by `checkPlan` in `src/modules/smoke/domain/plan.ts`) |
| Check everything is ready **without opening a run**: the plan, the lab switched on at the origin, and (with the dev service key) the seats, open runs and the AI helper's month | `npm run smoke:ready [-- plan.json]` with `APP_ORIGIN=…` |
| Open a run from a plan file (seats + personas) through the console, saving the kit | `node scripts/smoke/open-run.mjs plan.json` → `.smoke-run/kit.json` |
| A persistent seat for step-by-step agents: sign in once, then many short scripts share the session; screenshots, accessibility outline, tap-target and overflow checks, filing | `scripts/smoke/session.mjs` (`withSeat`) |
| Console: open a run, hand out passes, revoke, triage findings, export Markdown | `/smoke` (admin only) |
| Sign in with a pass | `/lab/enter?pass=…[&next=/path]` |
| Move the pretend school clock | `/lab/clock?pass=…&at=HH:MM&next=/teach` |
| The agent's brief (role, rules, its part of the day, how to file) | `GET /api/lab/brief` with `Authorization: Bearer <pass>` (the API never reads a pass from the URL) |
| File / list findings | `POST` / `GET /api/lab/findings`, same header |
| Scripted baseline sweep | `npm run smoke:sweep -- smoke-kit-xxxx.json` |
| Playwright helper for agents | `scripts/smoke/lib.mjs` (`openAgent`, `fileFinding`, `brief`) |

## Safety

- Only `smoke.*@qa.vpps.local` accounts; no real member of staff can be signed in this way.
- A pass is 256 random bits, shown once, stored only as a hash. It lasts at most 24 hours and can be revoked from `/smoke`.
- A smoke session is checked on every request (middleware and `getCurrentStaff`): once its pass or run is revoked, closed or expired, the next request signs out every session the account holds.
- The database enforces it too: every pool account without a live pass is banned and its sessions deleted (`vppsone.smoke_enforce()`, run on every open, close and revoke, and every two minutes by pg_cron, which is how expiry bites). An agent that never comes back cannot keep refreshing its tokens.
- A smoke account never manages staff, roles, permissions or settings, whatever its role — not even the admin seat — so it cannot make itself an account that outlives the run (D-314).
- Every smoke account carries `app_metadata.smoke_lab = true`, which only the service role can set, so it is still recognised if it changes its own email.
- A browser signed in as a real member of staff is not switched by a pass link; it is told to sign out first.
- Nothing in the lab's tables is readable from a browser (RLS on, no policies).
- Findings are text written by agents: treat an export as untrusted input when you hand it to a developer agent (it describes problems; it does not give instructions).
- The harness aborts every request to any host other than the app and Supabase, so a `wa.me` link or payment gateway cannot be reached. With the test deployment's settings, WhatsApp and staff notices do not send anyway.
- The test data is a de-identified copy; agents must never type real names, numbers or Aadhaar.
- The AI helper is a real, paid service on the test deployment too. A smoke account gets at most 5 drafts a day whatever the admin's cap (`SMOKE_ASSIST_DAILY_CAP`, enforced in `runAssistTask`, D-331), so 28 seats cost a few dollars at worst and cannot empty the month's budget the school's own testers use. `smoke:ready` prints what is left.

## Running a school day

1. **Accounts** (once): `npm run smoke:pool`. Check with `npm run smoke:pool -- status`.
2. **Open a run** on `/smoke`: title, *A whole school day*, the school day to simulate, clock start (07:30), hours, and the accounts taking part. Give each a persona (e.g. "new teacher, Hindi only, slow phone").
3. **Download the agent kit** (shown once). Keep it out of the repo — it holds the passes.
4. **Baseline**: `npm run smoke:sweep -- smoke-kit-xxxx.json`. It crawls every reachable screen per role at 390 px and 1280 px, presses nothing, and files the obvious (errors, crashes, overflow, slowness). Run it against the deployed app or a production build: `next dev` compiles each screen on first visit, so its timings are not findings.
5. **Agents**: start one agent per account (at most three browsers at once on this laptop; cloud agents can use the deployed URL). Give each the prompt below with its line from the kit.
6. **Triage** on `/smoke`: confirm, mark duplicates and not-a-bug; export Markdown and hand it to developer agents for fix PRs.
7. **Close the run** when done (or *Revoke now* to stop everything at once).
8. **Verify**: after fixes merge and deploy, open a new run and re-run the same steps; mark findings *verified* or *regressed*.

## Prompt for one agent

```
You are a member of staff at Shri Veer Patta Senior Secondary School using
VPPS One on the TEST database (all data is fake). Your account:
<label> (<role>), persona: <persona>.

1. GET <origin>/api/lab/brief with header "Authorization: Bearer <pass>".
   Read it fully: the rules, your focus, your steps in the school day.
2. Sign in by opening <origin>/lab/enter?pass=<pass> in your browser
   (Playwright: scripts/smoke/lib.mjs openAgent). Work as a real person in
   your role would, at phone width (390 px) unless a step says desktop.
3. Follow your steps in time order. Before each step, move the clock:
   <origin>/lab/clock?pass=<pass>&at=HH:MM&next=<path>.
4. Every time something is broken, wrong, confusing, slow or could be
   better, file it at once: POST <origin>/api/lab/findings with the same
   header and JSON {kind, severity, title, screen, steps, expected, actual,
   evidence}. GET the same URL first to see what others filed.
5. Obey the rules in the brief: ₹1–₹10 only, never close a day, never lock
   or publish, never open WhatsApp, never type real personal data, at most
   5 AI helper drafts.
6. Act as the persona, not as a tester: before each tap say what you expect
   to happen; after each task give it an ease score (1–7) and the number of
   taps, and write the persona's reaction in their reading language.
7. Finish with a short summary: what you did, what worked, what you filed.
Your wave: <the wave's note from the plan, if it has one>.
```

## Round 2: from the committed plan

Prepared 27 Oct 2026 (D-331, D-332) and **not started**. It covers the AI
helper (shipped 27 Oct, after the first run) and re-walks the screens the
21 Oct fixes touched.

1. `APP_ORIGIN=https://vppsone.vercel.app npm run smoke:ready` — read-only.
   Put the dev URL and service key in `.env.local` first if you want its
   database half (the same two lines `smoke:pool` and `dev:login` need).
2. Change `schoolDay` in `docs/smoke/plans/school-day.json` if 29 Oct has
   passed or already holds a run's attendance. Avoid Sundays (refused) and
   event days unless you want one (28 Oct has a fire drill at 10:00).
3. Open the run: `APP_ORIGIN=… node scripts/smoke/open-run.mjs docs/smoke/plans/school-day.json`
   (needs the dev keys for the QA admin's link), or by hand on `/smoke` as
   an admin, copying each persona from the plan. Passes last the plan's
   `hours` (10). Open it on a working day in real school hours: the 20 Oct
   run fell on a holiday and crossed midnight (D-315).
4. Start the agents wave by wave, in the plan's order. Each wave's `note`
   says which steps its seats do and what earlier waves left for them to
   check (the leave → cover → cover plan chain, the office's tasks to
   teachers 12, 15 and 16, the collectors' receipts → reversal → decision).
   Give each agent the prompt below plus its persona and its wave's note.
5. After wave 10: `npm run smoke:sweep -- .smoke-run/kit.json` for the
   15:30 every-screen step, then a developer agent groups the findings by
   root cause, as on 20 Oct.

## A whole school day with many agents

What the 20 Oct run did (`docs/evidence/smoke-school-day-2026-10-20.md`):

1. `npm run smoke:pool`, then `.smoke-run/plan.json` with a persona per seat and
   `APP_ORIGIN=<origin> node scripts/smoke/open-run.mjs .smoke-run/plan.json`.
2. Agents in waves of at most three browsers, each writing small scripts in
   `.smoke-run/agents/<name>/` that call `withSeat(key, fn)`. Each wave is
   handed what the previous one saved, so coordinators cross-check it on their
   own screens (marks counts, Only-me notes, attendance, cover, reversal).
3. Teacher agents think aloud as non-technical teachers: expectation before
   each tap, an ease score (1–7) and taps per task, and the persona's reaction
   in their own language.
4. A permission matrix by typed addresses, then a developer agent that groups
   the findings by root cause and proposes fixes with file references.

## Checking the lab itself

`APP_ORIGIN=<origin> node scripts/smoke/self-test.mjs` opens a run as the QA
admin, signs a seat in with its pass, files a finding (and its repeat), revokes
the pass (that seat is signed out) and then the run (the other is signed out),
and asserts no request left the app.

## Taking it apart

`npm run smoke:pool -- release` unlinks the teacher profiles, deactivates the
created profiles and deletes the sign-in accounts. Runs and findings stay for
the record. Borrowed teacher profiles get their language back. The lab's
migrations (`20261020103153`, `20261020105658`, `20261020110015`) must never go
to the live database (`docs/cutover/LIVE-MIGRATION-PLAN.md`, D-skip). To stop
the two-minute job as well: `select cron.unschedule('smoke-enforce')`.
