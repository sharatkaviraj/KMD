# `public/` — and the PWA that is deliberately switched off

`branding/`, `fonts/`, `manifest.webmanifest`, `offline.html` and
`service-worker.js` came across with the School Fees port. The first two are
live: the school mark in the sidebar and on the sign-in screen, and the fonts
the design depends on.

**The other three do nothing, on purpose.**

Nothing links the manifest and nothing registers the worker —
`src/ui/system/service-worker-registration.tsx` exists and is not mounted.
Turning them on would make VPPS One an installable app, and the manifest's
shortcuts are the fee app's: Payment Desk, Defaulters, Transactions. That is
right for an accountant and wrong for a teacher, who would install a school
workspace and find three fee shortcuts on her home screen.

Which shortcuts a person gets is a role question, and the fee app answered it
with a role-aware `/api/manifest` route keyed to *its* five roles. This app has
eight. Wiring that up is a product decision about what an installed VPPS One
is, and nobody has made it — so the files sit here, correct and inert, rather
than being deleted (they would only have to be ported again) or switched on
without anybody choosing to.

## One thing that is not optional

`src/proxy.ts` must keep excluding `manifest.webmanifest`, `offline.html`,
`service-worker.js` and `branding/` from the auth matcher. It did not, and
production answered the first two with a 307 to `/login`. An installed app
fetches the manifest on every launch, and the offline page is wanted precisely
when there is no network to sign in over — an auth redirect is the one answer
neither can use. `branding/` is the logo on the sign-in screen, wanted before
there is a session to check.

That holds whether or not the PWA is ever switched on.
