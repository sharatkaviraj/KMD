# PR79 deployed read-only phone acceptance

Prepared source only: eight Chromium touch cases, one worker, no retries, bounded
120-second case timeout. Portrait accountant Books at 360/390/412 x 844 plus
844 x 390 landscape, admin collection review at 390, teacher notes at 390.
No local browser, database or auth action was executed during preparation.

The production canonical origin is fixed to `https://vppsone.vercel.app`.
Every browser non-GET and every noncanonical GET is blocked. Screenshot, trace
and video recording are off. Evidence includes geometry and owned synthetic
fixture IDs only; no auth URL, headers, cookies or token are logged. Auth failure
is replaced with a generic error after clearing the page to `about:blank`.
Output defaults to `../evidence/pr79-deployed-readonly/`, separate from earlier
production artifacts; override `PR79_READONLY_OUTPUT_DIR` if retaining another
bounded attempt. Private failure context is not a shareable family-data artifact.

Existing QA user/profile/role bindings must match before generating an ephemeral
magic link. The service key stays in the Node runner. No user, password, grant,
profile, financial record, note, family message or fixture is created/modified.
The existing Supabase [listUsers](https://supabase.com/docs/reference/javascript/auth-admin-listusers)
and [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
APIs were checked against their current official documentation during preparation.

| Cases | Read-only acceptance / limitation |
| --- | --- |
| Accountant x4 | Independently verify retained Apr3 cheque333 metadata/two events, trust-tap Cleared tab, read own row, measure actual last row above native nav; compare exact retained DB state afterward. Cleared cheque already has details, so Add-details open/close is explicitly **blocked by fixture**, not claimed passed. No alternative fixture or real family's action is activated. Books source has no payment-date filter; Apr3 is the retained receipt date, not a guessed query feature. |
| Admin x1 | Verify exact pending B from retained request, select only its checkbox/hidden ID, read selected decision-button geometry, clear selection and compare exact submission/record/history state. No approve/reject or select-all action. If the real bulk UI is unavailable because fewer than two changes remain, record selection scope blocked rather than manufacture another fixture. |
| Teacher x1 | Trusted composer open, note focus, simulated keyboard viewport shrink. Retained child is eligible for local draft/review only if independent student tag and current own-class enrolment match; no Save activation and no tagged persisted note. Otherwise verify empty composer/disabled footer, record review scope blocked. Restore viewport and close. No physical keyboard evidence. |
| Admin contact x1 | Independently verify the tagged synthetic accountant child and exactly two coordinator-supplied owned contact IDs/note, read latest-contact UI, open/close an empty composer and measure 44px controls; no Save or Check action. Missing retained IDs/note block this scope. |
| Admin context x1 | Open the same own profile with an explicit encoded directory return query (search/class/fees/pending/page2), verify and trusted-tap the actual 44px Back link, then assert exact real Next directory URL. Actual Family-to-Sibling production traversal is explicitly blocked because the owned child has no synthetic sibling relationship. |

No case proves an unperformed mutation. `writeCount=0` is restricted to browser
business-action requests and exact retained readbacks; it does not imply that
ephemeral authentication sessions were never established. No protected LIVE DB
cutover, migrations, persistent credentials or cleanup are authorized here.

Execution requires the coordinator's explicit serialized browser release plus:

```powershell
$env:PR79_READONLY_RUN='yes'
$env:PR79_READONLY_DEPLOYED_SHA='<exact 40-character deployed merge SHA>'
$env:PR79_READONLY_DEPLOYMENT_FILE='<fresh coordinator manifest JSON path>'
node node_modules/playwright/cli.js test --config tests/playwright/pr79-readonly.playwright.config.ts
```

After the genuine DEV contact acceptance, coordinator also supplies exact
`PR79_READONLY_CONTACT_IDS` (two distinct comma-separated retained UUIDs) and
`PR79_READONLY_CONTACT_NOTE` (exact `OPS-CONTACT-20261012`-prefixed text). These
are test fixture identifiers only. This production suite creates no contacts.

Manifest required fields: `state: READY`, `target: production`, matching `sha`,
`aliases` including `vppsone.vercel.app`, fresh `checkedAt`, exact
`projectRef: wtgxcptmucjerhufzjcf`, and fresh `projectCheckedAt`. Both checks must
be under 15 minutes old. Actual app database binding also requires
`productionPublicUrl: https://wtgxcptmucjerhufzjcf.supabase.co`,
`productionEnvTarget: production`, a fresh `productionEnvCheckedAt` under 15
minutes old, and numeric `productionEnvUpdatedAt` no later than numeric
`deploymentCreatedAt`. The coordinator obtains only the NONSECRET public URL
via the official Vercel environment API; keys and other environment values are
not read. Local `.env.local` must target that exact DEV hostname.
The prepared guard currently requires local HEAD equal deployed SHA; coordinator
will review whether committed-ancestry validation is needed when PR80 advances
the local test source. There is no automatic execution while deployment is pending.

Source-only validation: scoped ESLint exit 0 and focused TypeScript zero owned
diagnostics at `2026-10-11T18:10:55.294Z`. Actual runtime results remain **not run**
until authorized exact deployment/slot release.

The optional `preflight.mjs` performs unauthenticated, bounded canonical login
and static-script GETs. Its October 12 inspection found **zero Supabase refs**
in the public client inventory, so it failed closed and did not authorize any
sign-in. This is no claim of a wrong database or a bundled DEV URL found. The
official production public-URL proof above provides the explicit binding when
the public page does not serialize a Supabase client. No auth action is made by
that optional script.
