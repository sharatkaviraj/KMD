# Overnight QA launcher: six existing identities

Scope: development project `wtgxcptmucjerhufzjcf` only, production Vercel deployment only. Protected project `vgqyilgstjvgohrsiwkb` is refused. No new Auth users, profiles or assignments; no existing SQL policies/helper functions, public data or Storage policy changes.

## Identity and browser boundary

- Raj's exact existing Auth/profile IDs, active admin role, fresh authenticated user and still-current Auth session are checked on every owner operation.
- Owner page: `https://vppsone.vercel.app/qa/dayrun`.
- QA page: `https://vppsone-veerpattas-projects.vercel.app/login/dayrun`.
- Both hostnames were verified against the same production deployment and independently inspected in the cloud browser. Main hostname retained Raj; QA hostname showed signed-out login. Auth cookies are host-only; emitted QA cookies are Secure. Pairing cookie is additionally HttpOnly/SameSite=Strict.
- One additional hostname gives one QA cookie context. Roles run sequentially, not concurrently. Use **End this test session** on the QA page, never the application's ordinary global logout, between roles.
- QA browser creates a five-minute random secret kept only in its host-bound cookie. Raj approves the visible public pairing ID and exact QA hostname. Only six pinned aliases are accepted. OTP generation and verification stay server-side; no password, key, session or magic link is shown/copied.
- A wrong owner, preview role, wrong origin, altered account binding, missing user, re-used grant or failed admission refuses sign-in. Auth cookies are buffered until exact identity, lease persistence and normal admission succeed.

## Existing account mapping

| Alias | Existing account | Role | Existing home class |
|---|---|---|---|
| admin | qa.admin@qa.vpps.local | admin | whole school |
| accountant | qa.fees@qa.vpps.local | accountant | role access |
| academic | qa.academic@qa.vpps.local | academic_coordinator | role access |
| exam | qa.exam@qa.vpps.local | exam_coordinator | role access |
| teacher | qa.teacher@qa.vpps.local | teacher | Class 1 |
| teacher2 | qa.teacher2@qa.vpps.local | teacher | Class 6 |

The two teachers retain their actual existing teaching assignments, which may include other classes. Multiple fictional novice personas may share these identities in sequential waves; they are not additional authenticated users.

## Expiry and cleanup limits

The run starts disabled. Raj may enable it after verification. It expires at **2026-10-19 07:00 UTC / 12:30 IST** and can be permanently revoked earlier. End-session revokes that lease and signs out locally. Existing unrelated sessions of these QA accounts remain unaffected.

**Expiry/revocation applies only to VPPS One application authorization guards. It does not revoke existing direct Supabase access, including vppsone REST/RPC, public-schema data or Storage permissions.** JWT validity and direct permissions remain inherited from the existing accounts. No project-wide JWT/security setting changes are made. New identities remain excluded because inherited direct access needs a separate security review.

Private registries retain nonsecret identity/session-ID tombstones. Deleting them would remove the app lease restriction, so triggers prevent deletion/truncation and clearing revocation. Cleanup is revocation, not deletion or dropping this migration. No school records or existing profiles are deactivated.

## Migration and verification

Shipping migration: `supabase/migrations/20261018191000_overnight_qa_app_sessions.sql`.
It adds four private tables, eleven new scoped functions and grants/triggers on only those new objects. Ordinary users cannot read the registries or invoke control RPCs; authenticated clients may only call the no-argument own-session predicate.

The earlier broad RLS proposal was rejected and remains unapplied outside this repository. It is not part of this release. Do not run earlier `database.sql` or `database.verify-rls.sql` artifacts.

Before activation: independent source review, complete unit/integration/type/build gates, private-table/control-RPC denial checks and existing-session predicate preservation. Then canary: exact approved teacher identity/class, Raj unchanged on main host, replay refusal, local End-session and preserved unrelated QA sessions. Do not describe mocked tests as deployed UI or direct-RLS proof.

## Recorded checks (2026-10-18)

- Full suite: 13,969 tests / 214 files passed. Mocked auth/adapter/middleware tests are not deployed UI evidence.
- Production build and TypeScript passed; ESLint had zero errors (nine pre-existing warnings). Port rewrite and route-bundle gates passed.
- Independent review approved reduced SQL SHA256 `7b2f39cecd02b838f518eede9f63b5707859e65f937fea63d95a24cff1a5eb6f` with run disabled.
- Reduced migration applied only to development. Rollback-only hosted verification passed: disabled lease predicate refuses; private registries/control RPCs refuse authenticated access; existing direct self-read and unrelated QA/owner sessions remain allowed.
- Existing-policy fingerprint before/after: `b3aff334371d5644b1caba9e831157a9`. Existing-function fingerprint before/after: `8aa0342793c55dc077162f034fce737f`. Run disabled, zero pair/session rows after rollback, 29 active profiles unchanged.
- Deployment and genuine browser pairing remain separate gates after these checks.

Teacher subject scope observed before rollout: QA Teacher teaches Class 1 ELGA/EVS, Classes 2–3 ELGA/Mathematics, Class 4 ELGA, Class 5 ELGA/English. Jainendra teaches Class 6 Hindi/Sanskrit, Classes 7–9 Hindi, and Hindi for every Class 11/12 stream. Existing scopes were not altered.
