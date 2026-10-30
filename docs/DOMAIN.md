# VPPS One at `one.vpps.co.in`

The school's own address for this app, from 30 October 2026 (D-336). It is the
same Vercel deployment as `vppsone.vercel.app`, not a second one: same build,
same database, same crons. Nothing about the data changes.

## How it is wired

| Layer | Setting | Where |
|---|---|---|
| DNS | `CNAME one → ade918e9b8269018.vercel-dns-017.com`, **DNS only** (grey cloud), TTL Auto | Cloudflare, zone `vpps.co.in` |
| Hosting | `one.vpps.co.in` attached to project `vppsone`, production, no redirect | Vercel › vppsone › Domains |
| Certificate | Issued by Vercel once the CNAME resolves | automatic |
| App URL | `NEXT_PUBLIC_SITE_URL=https://one.vpps.co.in` on **Production only**; Preview and Development keep their own value so a preview never links to production | Vercel › vppsone › Environment Variables |
| Origin list | `VERIFIED_ORIGINS.vppsone` = `https://one.vpps.co.in` | `src/platform/config/app-origins.ts` |
| Auth | `https://one.vpps.co.in/**` in Redirect URLs. Site URL left at `http://localhost:3000` on purpose (below) | Supabase › schoolfees-dev › Authentication › URL Configuration |

The DNS record must stay grey. Proxying it through Cloudflare puts a second CDN
and a second certificate in front of Vercel's, and Vercel then cannot renew its
own. `fees.vpps.co.in` (the fee app) is set up the same way.

`NEXT_PUBLIC_SITE_URL` is read into the browser bundle at build time, so it only
takes effect on the next production build. It decides the address printed on
receipts, in receipt QR codes, WhatsApp messages and PDF footers
(`getSiteUrl()` in `src/platform/env.ts`).

## What does not change

- Sign-in is a password, or a server-side one-time link (`verifyOtp` with a
  token hash). Neither redirects through Supabase, so no sign-in breaks, and
  the app sends no auth email that would use Supabase's Site URL. That is why
  the Site URL on schoolfees-dev stays `http://localhost:3000`: the same
  project serves local development. Set it to `https://one.vpps.co.in` only if
  the app starts sending invite or reset emails. At cutover the live project
  needs the same redirect URL.
- Crons call the production deployment, not a hostname.
- Google Drive storage authenticates with Vercel's OIDC token (project and
  environment in the subject), not a hostname.
- `vppsone.vercel.app` keeps answering. The smoke scripts and the expired
  day-run pairing are pinned to it on purpose.

## What staff notice

- Sign-in cookies belong to a hostname, so everybody signs in once on the new
  address.
- A phone that installed the app from `vppsone.vercel.app` keeps opening the old
  address. Remove that icon and install again from `https://one.vpps.co.in`.
- Receipts printed before the switch carry the old address; it still works.

## Order it was done in

Each step leaves the app working, so it can stop at any point.

1. Add `one.vpps.co.in` to the Vercel project. Harmless until DNS points at it.
2. Add the CNAME in Cloudflare, DNS only.
3. Wait for Vercel to show the domain valid and serve a certificate; check
   `https://one.vpps.co.in/login` says VPPS One. On 30 Oct the certificate
   only came after `vercel certs issue one.vpps.co.in`; it renews itself.
4. Supabase URL configuration: add the new redirect URL.
5. Split `NEXT_PUBLIC_SITE_URL`: production gets the new address.
6. Merge the origin change; its production build picks up step 5.
7. Check end to end: certificate, `/login`, a receipt's printed address, a
   cron run the next morning, `npm run verify:origins`.

## Rolling back

Undo in reverse, any subset:

- Delete the production-only `NEXT_PUBLIC_SITE_URL` and add Production back to
  the targets of the shared one (it still holds the old value), then redeploy.
  Receipts go back to the old address.
- Revert the origin commit.
- Delete the Cloudflare record and remove the domain from the Vercel project.
  `vppsone.vercel.app` was never touched, so staff can go straight back to it.

## Later, not now

Redirecting `vppsone.vercel.app` to the new address would move everybody at
once, but it would also break the smoke scripts and any tab with unsaved work.
Leave both answering until staff have moved, then decide.
