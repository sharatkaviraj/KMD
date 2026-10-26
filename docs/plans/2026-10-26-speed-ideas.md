# Speed and smoothness ideas — 26 October 2026

Ranked from reading the code, with no new measurements. Nothing here is built yet. The
numbers in brackets come from the repo's own evidence files.

Already done, so not listed: both Vercel and Supabase in Mumbai (D-240), `sharedCache`,
`staleTimes` 300 s, hover/touch prefetch, lazy xlsx/QR/realtime, service-worker static
cache, Student 360 tab switching in the browser.

## Quick wins

1. **Split `src/messages/index.ts`.** It is one 114 KB object (~30 KB gzipped), imported
   by 44 client files, including `ui/system/service-worker-registration.tsx`, which the
   root layout mounts on every route, /login included. Split it per module, or pass the
   strings from the server.
2. **Trim the fee layout's next-intl payload.** `app/(app)/fees/layout.tsx:77` passes the
   whole `getMessages()` (115–180 KB). Send each route only the namespaces it uses. Fee
   page HTML is ~320 KB (`evidence/performance-live-after-2026-10-06.json`).
3. **Sign straight in to the menu home.** `login/login-form.tsx:125` goes to
   `/dashboard`, which then redirects. That is one extra full layout and shell render.
4. **Fonts.** The root layout preloads up to 8 files (Inter, Source Serif 4 ×3, Noto Sans
   Devanagari ×4). Keeping only Regular and Bold Devanagari and not preloading the serif
   saves 150–250 KB on a first visit.
5. **Cache the shell avatar.** `collection/data/approved-photos.ts` makes two reads in
   sequence on every render and signs a new 300 s URL each time, so the browser never
   reuses the image. Put it behind `sharedCache` and use a signed URL that stays the same
   for an hour.
6. **Check the Supabase JWT signing mode.** `getClaims()` runs in middleware and again in
   `auth/current-staff.ts`. With legacy HS256 secrets, each call is a network trip.
   Asymmetric keys let both calls check locally.

## Smoother

7. **Stream the admin Today screen.** `app/(app)/page.tsx:63-74` waits for the slowest
   of money, inbox and attendance. Give each its own `<Suspense>` boundary.
8. **Real loading screens.** 91 pages share the generic `(app)/loading.tsx`, and 11 have
   none. Start with the ten most-visited routes.
9. **Flatten the teacher home.** `vx/screens/teach/data.ts:442-547` reads the database in
   4 sequential rounds. `classInsight` runs once per class, at 5 reads each. One
   `vppsone.teacher_home(...)` RPC could return the whole page. Also reuse the cached
   `staff_ui_preferences`.
10. **Fewer double renders.** There are 131 `router.refresh()` calls, often right after a
    `revalidatePath`, and 16 `revalidatePath("/", "layout")` calls clear everything.
    Use narrow `revalidateTag`. Use `useOptimistic` for attendance, marks and payments.
11. **Make OfficeSyncListener update only what changed.** It runs a full `router.refresh()`
    for every office sync event. Patch the day-total widget from the realtime row instead,
    or refresh at most once per 30 s during a busy collection hour.

## Bigger bets

12. **Use an absolute bundle budget.** Routes grew from 126–169 KiB to 223–264 KiB gzipped
    with the redesign (`evidence/smoothness-2026-10-01.md` → `smoothness-redesign.json`).
    `check:bundles` only fails on +10% against its own baseline. Give each route a fixed
    ceiling and run a bundle analyzer on `/login`, `/dashboard` and `/fees/transactions`.
13. **Measure on real phones.** Record web vitals (LCP/INP) per role and route. Today
    there are only lab numbers; the slowest 5% of `/fees/payments` takes 4.5 s.
14. **Offline-tolerant attendance and marks.** Queue writes in IndexedDB through the
    existing service worker, so a weak classroom signal never blocks a teacher.
15. **Batch dues reminders.** `vx/screens/dues/screen.tsx:271` makes one server call per
    family, in a loop from the browser.
16. **Partial prerendering / `use cache`** for the static shell, so only the data parts
    stream in.

Suggested order: 1 → 2 → 3 → 13 (so the rest can be measured) → 7 → 9 → 10.
