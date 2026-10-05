# Veer Patta Public School branding

The workspace display identity is **Veer Patta Public School**, as confirmed by
the owner on 5 October 2026. The environment-free `schoolBrand` configuration in
`src/platform/config/school-brand.ts` owns presentation; `schoolProfile`
continues to own the identity, contact details and prefix printed on receipts.

## Asset sources

| Asset | Source | Use |
| --- | --- | --- |
| `public/branding/veer-patta-school-logo.jpg` | Existing School Fees branding; identical SHA256 in both checkouts | Full logo on sign-in |
| `public/branding/veer-patta-emblem.png` | `Projects/timetable2025/icons/icon-512.png`, copied without modification | Compact sidebar and welcome mark |
| `public/branding/icon-192.png`, `icon-512.png` | Existing School Fees/VPPS One installation assets | Browser, Apple and installed-app icons |

The owner removed campus photography from the design after reviewing it on
5 October 2026. Login and dashboard banners use the school navy surface and
logo. The photo component, source asset, attribution and configuration were
removed. No third-party school statistics or contact details are used.

## Shared theme

School blue and teal replace the fee reference's ink/saffron brand colours.
The existing token names, component geometry, typography, semantic status
colours and financial behaviour remain. Dark mode retains its readable dark
surfaces and uses lighter teal accents. Next.js image loading follows the
installed v16 guide, including `preload` in place of deprecated `priority`.

## Native navigation

Admin and office: Home, Students, Collection, Fees, More. Destinations derive
from the current role permission map. Accounts roles retain their existing
native fee home; teacher/coordinator homes are unchanged. `/apps` is a bookmark
compatibility redirect, and old `app:schoolfees` / `app:sampark` preferences
resolve to permitted internal destinations. No profiles are migrated on read.

The original-app origin registry remains available for historical diagnostics;
the runtime shell, home, student actions and preferences do not use it to send
staff out of VPPS One.

## Installation

The existing cross-platform PWA keeps its stable `/` identity, role-aware start
route, verified 192px and 512px school icons, standalone display and offline
reconnect screen. Installation guidance is available on sign-in and Preferences.
Chrome/Edge and Android use the browser install prompt when available; iPhone
uses Safari's Share → Add to Home Screen. The public asset cache moves from v4
to v5 so an installed app refreshes its branding. Private pages and financial
mutations remain online; recoverable form drafts remain on the device.
