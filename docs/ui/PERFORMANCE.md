# Making the app feel instant

Janmejay, 10 Oct 2026: the student page should open faster, going back to the
student list should not reload it, the app should keep what it has already
loaded, and the fee side of a child should read like the Fees app.

This file is the brainstorm, what shipped, and what is left. Database rules are
unchanged: schoolfees-dev only, fee data read through the fee app's own
queries, no figure recomputed.

## Where the time went

| Screen | What it waited for, before |
|---|---|
| Every page (full load) | Staff profile, **then** the permission matrix; then the shell read large text after the preview permissions. Two pairs of round trips in a row. |
| Students list | Session (2 reads) → class names (2 reads) → the money list. Class names and the session were re-read on every navigation though they change a few times a year. |
| Student 360 | Session → the child's card → 8 school reads → **then** the fee side (session, 4 reads, then receipt reversals) and notes. Three waves in a row. |
| Student 360 tabs | Every tab was a link: a full server render of all of the above, to show data the page already had. |
| Back to the list | The phone back arrow was a *new* navigation to `/students`: filters, page and scroll lost, and refetched once the 60 s router cache had expired. |

## Ideas, strongest first

1. **Tabs without the server.** Student 360 already reads every tab's data;
   switch tabs in the browser and keep the URL in step with `replaceState`. ✅
2. **One wave of reads on Student 360.** Start the fee side and notes before
   the school side, read the card beside the rest, chain receipt reversals
   off the receipts instead of after everything. ✅
3. **Back means Back.** When the screen behind is the list, the back arrow
   takes the browser's own Back, which restores the cached list with its
   filters and scroll. Bookmarks and deep links keep the plain link. ✅
4. **Keep pages for five minutes.** Router cache `dynamic` 60 s → 300 s. Safe
   for the same two reasons it was safe at 60: every write revalidates, and the
   realtime listener refreshes open screens when money moves. ✅
5. **Fetch on intent.** A student row starts loading the whole Student 360 on
   touch, focus, or a 90 ms mouse rest, so most of the render is done before
   the click lands. ✅
6. **A skeleton in the card's shape.** Student 360 gets its own loading screen,
   prefetched with each visible row, so a tap shows the right outline at once. ✅
7. **Cache what barely changes, across requests.** Class names (5 min, busted
   by every alias write) and the session facts (1 min, the fee app's own
   `app-settings` tag) through `sharedCache`. Permission checks stay outside
   the cache, on every request. ✅
8. **Parallel profile and permissions** for every signed-in request, and the
   shell's two reads at once. ✅
9. **The Fees tab is the Fees app's student page.** Same money band (Outstanding,
   Paid this session, Session fee, Last receipt) and its one-line ribbon, the
   same Dues table (Charged − Paid = Outstanding, late fee and waivers under
   Charged, "receipted here" when the pool moved money), the fee breakup with
   overrides and discounts, receipts with their modes. Figures come from the
   same rows and sums as `/fees/students/[id]`; the fee plan and waivers link
   through to it. ✅

10. **Stream the fee side.** (11 Oct) The card goes out with the school side;
    the fee app's reads are a promise the page does not await, and Student 360
    shows skeletons in the money tile, Fees and Family until it lands. ✅

Measured on live after idea 10 (11 Oct, median of 3): open Student 360
1247 ms desktop, 1242 ms phone; fees showing 1249 / 1244 ms. The fee side
arrived with the card in 5 of 6 opens, so streaming it changed little: the
second is spent before the card, in the sign-in checks, the session and the
school-side reads. That is where the next pass should look.

### Not done, and why

- **Persisting lists in the browser between visits** (IndexedDB/service
  worker). Office PCs are shared, and the list carries phone numbers and
  money; a copy that outlives the sign-in is a privacy cost. The service worker
  keeps caching build assets only.
- **`.in(id…)` with a directory segment on the students list** (ported fee
  query) can carry several hundred ids in the URL, which rule 3b says hangs at
  about 400. Watch the "Pending" chip on live; chunking it is a fee-module
  change.
- **Payment Desk parity.** The desk already posts through the fee app's own
  action and preview; screen-by-screen parity is a separate pass.

## Measuring

`/mnt/project-files/perf/measure.mjs` (also run from `.perf/` on the office
PC) signs in as the QA admin and times: list full load, opening Student 360,
switching a tab, browser Back, the phone back arrow, and Back after 70 s. It
only opens pages.

### Results on live, 10 Oct (median ms, 3 rounds)

| Step | Desktop before → after | Phone before → after |
|---|---|---|
| List, full load | 1434 → 1312 | 1623 → 1306 |
| Open Student 360 | 1027 → 1298 | 1042 → 950 |
| Switch tab | 685 → 51 | 615 → 46 |
| Browser Back to list | 159 → 107 | 116 → 95 |
| Phone back arrow to list | — | 154 → 91 |
| Back after 70 s | — → 135 | 89 → 106 |

Tabs are the win: no server trip after the first switch (the first still pays
600–700 ms while the page settles). Back is one press from any tab now, since
tabs replace the history entry. Opening Student 360 did not get faster; it is
still about one second; idea 10 streams the fee side to attack it.

## 6 November: real phones, and the next plan

The app logs Web Vitals from 10% of visits (`/api/performance`). From 3 to 5 Nov
(admin, phone and desktop): in-app navigations paint in 40 to 120 ms and taps
answer in 8 to 90 ms; the **first open** waits 0.8 to 3.9 s for the first byte
(once 6.6 s); the Students list's largest paint lands at 2.0 to 2.8 s on phones;
one screen shifted by 0.86. The full idea list, ranked, is the Claude Doc
"VPPS One: faster and smoother, ideas"; Janmejay chose to build it in order.

Batch 1 (D-427 to D-431):

- **Screen names in the speed logs.** About thirty fixed names instead of nine,
  so the next measurement says which screen is slow. ✅
- **One wave of reads before the frame.** The (app) layout started the session,
  the previewed role's permissions and the production marker one after another;
  the shell then read preferences, AI features and the staff photo in three more
  waves. Each is one wave now. ✅
- **Student photos stay in the browser for ten minutes.** The Fees photo route
  was `no-store`, so each list visit fetched every thumbnail again through the
  bridge. Avatars are also `loading="lazy"`, so off-screen rows wait. ✅
- **The tapped link answers.** NavLink dims its own link 80 ms into a slow
  navigation; Students rows use it. ✅
- **Lighter glass on touch screens.** 8 px blur, no saturate, denser tint. ✅
- Checked and dropped: animations that move layout. The ones left animate
  progress-bar widths once, which is cheap.

Not done yet: the native (non-bridge) student photos are still signed per
render (300 s URLs), so the browser cannot reuse them; that matters for test
accounts only today.
