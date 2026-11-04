# AI connection M0/M1: the security contract as built

**Status: implemented on `feat/mcp-m1`; migration NOT applied; no provider
tested; kill switch ships OFF.** This is the first secure slice of
`docs/plans/2026-11-03-mcp-feasibility.md` (option B, §5.2): One's own
OAuth 2.1 authorization server and a stateless MCP endpoint, read-only
§4.1 tools, admins only (D7), TEST for admins only (D11). Each guarantee
below names the code that enforces it and the test that pins it. Revised
after the independent review of PR #179 (findings M1, M2, L1–L7).

## Shape

- **Portable core** — `src/modules/mcp/domain/`: Web `Request` → `Response`
  handlers, Web Crypto, zod, injected store/staff/session/readers. No Next.js,
  Supabase, Node built-in or `process.env` (`tests/mcp/registry.test.ts`,
  "the portable core stays portable"; `tests/architecture.test.ts` `domain/`).
- **One adapters** — `src/modules/mcp/data/` (Postgres store, staff resolver,
  readers), thin route files under `src/app/.well-known/`, `src/app/api/mcp/`,
  the consent page `src/app/mcp/authorize/`, admin page
  `src/app/(app)/settings/ai-connection/`, card on `/preferences`.
- **Authority** — `supabase/migrations/20261103150000_ai_connection_mcp.sql`
  (vppsone only, service role only).

## How the guarantees are tested

- **In-process** (`tests/mcp/*.test.ts`, vitest): the core against an
  in-memory store (`tests/mcp/fake-store.ts`) that mirrors each SQL function;
  the One adapters (`verified-actor.test.ts`) against a faked service-role
  client.
- **SQL, one connection** (`tests/sql/ai-connection.mjs`, PGlite in CI): the
  real migration over a synthetic schema — every function's behaviour and
  every grant, run as `service_role`, `anon` and `authenticated`. Run locally
  before this revision and passing.
- **SQL, two connections** (`tests/sql/ai-connection-locks.py`, PostgreSQL 17
  in CI, `.github/workflows/ai-connection-sql.yml`): the concurrency
  guarantees, each schedule forced by an observed lock wait. Not runnable on
  the development machine (no PostgreSQL or Python there); first run in CI on
  commit `110f9801` — passed (job `single-use-locks`).
- **Concurrency (#8, #9, #10) is guaranteed by the SQL row lock and advisory
  lock**, not by the in-process tests: those prove the core's handling of the
  store's answers, and the fake store only *mirrors* the lock by running each
  check-and-set synchronously. The proof is the two-connection script above,
  plus reading the functions (`migration.test.ts` pins the lock statements and
  their order).

## Guarantees

| # | Guarantee | Enforced by | Test |
|---|---|---|---|
| 1 | Tokens and codes are opaque 256-bit CSPRNG values; only SHA-256 hex is stored; no signing keys, secrets or env vars | `domain/crypto.ts`; `ai_tokens.token_hash`, `ai_oauth_codes.code_hash` checks | `oauth.test.ts` "makes 256-bit tokens…", "stores only the code's hash…"; `migration.test.ts` "stores hashes" |
| 2 | PKCE S256 only; plain refused; verifier format checked | `validateAuthorizeRequest`, `handleToken`, `ai_exchange_code` compares S256(verifier) | `oauth.test.ts` "PKCE S256" (RFC 7636 vector), "refuses a wrong verifier…"; `ai-connection.mjs` mismatch |
| 3 | Redirect URIs match an allowlist exactly — at registration and again at consent; loopback only on a confined deployment; `claude.com` callback off the list until confirmed (L7) | `domain/redirects.ts`; `handleRegister`; `validateAuthorizeRequest` | `oauth.test.ts` "redirect URIs match exactly" (16 near misses incl. claude.com), "refuses a loopback redirect…" |
| 4 | Until client and exact redirect URI are proven, an error is a page in One, never a redirect; after, errors go back with `state` and `iss` | `validateAuthorizeRequest` (`show_error` vs `redirect_error`), consent page | `oauth.test.ts` "shows an error page…", "sends protocol errors back…", "passes state through and adds iss…" |
| 5 | `iss` on every authorization response (RFC 9207), so ChatGPT's stable redirect works and mix-up is caught | `domain/consent.ts`; metadata `authorization_response_iss_parameter_supported` | `oauth.test.ts` "passes state through…", "discovery metadata" |
| 6 | Issuer and resource never follow a forged Host on production; a confined deployment uses only its own Vercel/loopback origin | `canonicalOrigin` (`domain/origin.ts`) | `oauth.test.ts` "names the canonical resource and issuer…", "uses a confined deployment's own origin…" |
| 7 | Codes are single-use, 60 s, bound to client, redirect URI, challenge and resource; a reused code revokes the connection and every token from it; a mismatched or expired code is consumed and its connection ended | `ai_exchange_code` (`select … for update`) | `oauth.test.ts` "treats a reused code as replay…", "refuses an expired code", "refuses a code for another client…"; `ai-connection.mjs` |
| 8 | Of two concurrent redemptions of one code exactly one is issued tokens; the other is reuse | row lock in `ai_exchange_code` | **`ai-connection-locks.py` scenario 1** (SQL); `oauth.test.ts` "lets exactly one…" (core, via the mirroring fake) |
| 9 | Refresh tokens rotate; a used one presented again revokes the whole connection; two concurrent rotations = one rotation + one replay | row lock in `ai_rotate_refresh` | **`ai-connection-locks.py` scenario 2**; `oauth.test.ts` rotation/replay tests; `ai-connection.mjs` |
| 10 | Consent makes a PENDING grant — no token, nothing replaced, never listed or shown as allowed. Redeeming the code activates it and, under an advisory lock per staff member and provider with a re-read, ends every other unrevoked connection of theirs to that provider: two approvals never both stay live (L5) | `ai_create_grant`, `ai_exchange_code`, `ai_connection_list` (`activated_at is not null`), `isLive`, purge of never-redeemed grants | **`ai-connection-locks.py` scenario 3**; `oauth.test.ts` "consent makes a pending grant…" (4 tests); `card.test.ts` "never shows a consented-but-unredeemed grant…"; `migration.test.ts` L5 order |
| 11 | Access tokens 15 min; refresh never outlives the 90-day grant; the last access token is capped at the grant's end; the table refuses a longer grant | `ACCESS_TOKEN_TTL_SECONDS`, `ai_connections_lifetime` check, `least(…, expires_at)` | `oauth.test.ts` "never lets a refresh token outlive…", "caps the last access token…"; `ai-connection.mjs` "no token outlives its grant" |
| 12 | Refresh rotation re-reads the staff member: missing, inactive, moved or no longer eligible → `invalid_grant` and the connection revoked; switch off → 503, nothing consumed or revoked; no resolver → 503 (L6) | `refreshRefusal` in `domain/oauth.ts`; `oauthDeps().resolveStaff` | `oauth.test.ts` "refresh rotation re-reads the staff member" (5 tests) |
| 13 | Token endpoint: form-encoded only, each parameter once, RFC 6749 JSON errors, `Cache-Control: no-store`; dead grant = `invalid_grant` | `handleToken`, `readForm`, `oauthError` | `oauth.test.ts` "answers RFC 6749 errors as no-store JSON" |
| 14 | Dynamic registration is public-client only and limited per source: SHA-256 of the platform-set client address (`x-real-ip`; never stored raw, nulled after a day), 5 new clients a source an hour under 100 an hour per environment; production and Previews counted apart; the same source and redirect set within 10 minutes gets its existing client (M1) | `handleRegister`, `ai_register_client` (advisory lock per environment), purge | `oauth.test.ts` "registration limits each source…", "returns the existing client…", "never stores the client address…", "counts production and Previews apart…", ceiling test; `ai-connection.mjs` registration |
| 15 | RFC 7009 revocation acts only for the client the token was issued to; a refresh token ends the grant | `ai_revoke_token` | `oauth.test.ts` "RFC 7009 revocation"; `ai-connection.mjs` |
| 16 | No/invalid/expired token → 401 with `WWW-Authenticate: Bearer resource_metadata=…, scope="one.read"` (plus `error="invalid_token"` when one was sent); header only, never query; audience = canonical MCP URL | `handleMcp`, `bearerToken`, `liveAccess` | `transport.test.ts` "the MCP endpoint's authentication" |
| 17 | A foreign browser `Origin` → 403 (DNS rebinding); GET/DELETE → 405 `Allow: POST`; no `Mcp-Session-Id`; unsupported `MCP-Protocol-Version` → 400 | `handleMcp`, `allowedRequestOrigin` | `transport.test.ts` "the Streamable HTTP transport" |
| 18 | Every tool call re-runs, nothing cached: token → connection → **rate limit** → kill switch → staff → eligibility → TEST/session → permission + scope → arguments → run → one log row | `callTool` (`domain/mcp.ts`) | `pipeline.test.ts`, "re-reads everything on every call", "re-checks the token for each call in a batch" |
| 19 | The limit is checked before anything that can refuse: every call counts, refusals included; a limited token reaches nothing and writes at most one `refused:rate_limited` row an hour (L4); 60/hour, 400/day | `callTool`; `ai_call_counts` (`limited_hour`) | `pipeline.test.ts` "checks the limit before any refusal…", "limits each staff member…"; `ai-connection.mjs` counts |
| 20 | Kill switch `runtime_flags.ai_connection`: absent, unreadable or off refuses every tool (and refresh, #12); ships OFF | `store.killSwitchOn`; migration key widened like D-359 | `pipeline.test.ts` "refuses every tool while the kill switch is off…"; `migration.test.ts` |
| 21 | Staff read per call by the verified auth user with `readCurrentStaff`'s rules (matrix permissions, unknown role → view_only, confinement); missing/inactive/mismatched → 401 and connection revoked | `data/staff.ts` + `ai_staff_for_user`; `callTool` | `pipeline.test.ts` "refuses an inactive staff member…"; `verified-actor.test.ts` "resolveStaffForUser…" (4 tests) |
| 22 | Only the resolver can make a verified actor: a module-private WeakSet records each minted, frozen actor; look-alikes and copies are refused everywhere, including the fees-bridge context (L2) | `mintVerifiedActor` / `isVerifiedActor` (`platform/auth/verified-actor.ts`) | `verified-actor.test.ts` "only the resolver mints…" (incl. a source scan: only `mcp/data/staff.ts` calls it); `fees-bridge-projection-fetch.test.ts` look-alike |
| 23 | Eligibility is one function at consent, at every call and at every refresh: admins only (D7, one-line `AI_CONNECTION_ROLES` change for teachers); QA/Smoke accounts never | `domain/eligibility.ts` | `pipeline.test.ts` non-admin, demotion, teacher stage; `oauth.test.ts` L6 |
| 24 | TEST is for admins only (D11), on confined deployments too; session from `pickSessionLabel` via `sessionLabelForActor`, never from arguments; session fence re-checked in the pipeline | eligibility, `canAccessSession`, `isTestSessionLabel` check in `callTool` | `pipeline.test.ts` TEST tests |
| 25 | Each service-role twin (`…As(actor, …)`) repeats the screen's check AND applies the `test_session_fence` itself, before reading; marks are read only for registers of the fenced session; twins of RLS reads require `readsEveryClass` (L1) | `assertActorSession` in every twin; `markStatusesAs` re-checks register ids against the session | `verified-actor.test.ts` "every twin applies the test-session fence itself" (10 twins × 3 cases + permission, reason, marks, phone) |
| 26 | Inside an AI-connection read the fees-bridge projection uses the verified actor and ignores cookies entirely — the token holder controls the Cookie header on /api/mcp (L3) | `projection-fetch.ts` (`verifiedActorInContext()` first; no session cookie read) | `fees-bridge-projection-fetch.test.ts` "inside an AI-connection read…" |
| 27 | Arguments: strict zod (unknown fields refused), dates only, within −31/+14 days; no argument can name staff, role, session, school or "act as" | `domain/tools.ts` | `pipeline.test.ts` "rejects unknown fields…"; `registry.test.ts` strict-schema walk |
| 28 | Output is an explicit allowlist per tool, pinned; no reason, note, phone, email, fee, pupil field; the absence reason is never even read for `who_is_away` | `domain/projection.ts`, `TOOLS[].output`, `absencesOnAs({ withReason: false })` | `registry.test.ts` pins and leak tests; `verified-actor.test.ts` reason test |
| 29 | One metadata row per call: staff, connection, provider, tool (registry name or `unknown`), outcome, rows, duration — no arguments, names or text; service role only; 180 days | `logToolCall`, `ai_tool_calls` checks, `ai_purge` + job `ai-connection-purge` | `pipeline.test.ts` "logs no argument…"; `migration.test.ts`; `ai-connection.mjs` rejects a free-text outcome |
| 30 | All new tables RLS-on with no policy, all grants to anon/authenticated revoked, functions executable by service_role only | migration | `migration.test.ts`; `ai-connection.mjs` "browser roles reach no table or function" |
| 31 | Fail closed: a store or matrix failure answers 503, never a guess | `handleMcp` / `failClosed` | `transport.test.ts` "fails closed with 503…" |
| 32 | Disabling a login, Disconnect (own, D9) and admin Disconnect (any, D9) revoke connections; the switch and other people's connections need the admin role and a non-test account | `changeStaffAuthority` → `revokeStaffAiConnections`; `settings/ai-connection/actions.ts`; `preferences/ai-connection-actions.ts` | per-call and per-refresh refusal are the authority (#12, #21) |
| 33 | Consent stays behind sign-in with the full query preserved; Approve/Deny re-validate from the raw query, not rendered fields | proxy (not in `PUBLIC_PREFIXES`); `app/mcp/authorize/actions.ts` | `public-routes.test.ts` "still sends … the AI consent page to /login" |
| 34 | The consent page cannot be framed, is never cached, sends no referrer, names the redirect host, and tells the reader to approve only a Connect they pressed themselves just now (M2) | `next.config.ts` headers for `/mcp/:path*`; `app/mcp/authorize/page.tsx`; `aiConnectionMessages.ownAccountOnly` | `registry.test.ts` "the consent page cannot be framed", "…warns against a link made in someone else's account" |
| 35 | Card states come only from One's records; never "connected and working" | `domain/card.ts` | `card.test.ts` |

## Mandatory M0 provider tests (before the switch is turned on)

1. **Forwarded consent link (M2).** Start "Add connector" in Claude account
   **A** and stop at One's consent page; copy that URL. Sign in to One as an
   admin in a browser where Claude account **B** (or no Claude account) is
   signed in, open the copied URL and press Allow. **Pass:** account A gets no
   working connection (the provider's own `state`/session check refuses the
   callback that A did not start in that browser), and One's admin list shows
   no live connection — at most a pending grant that is never redeemed.
   Repeat for ChatGPT. If either provider accepts it, do not enable the
   switch; record the result and raise it.
2. **Redirect URIs.** Record the exact callback each provider sends. Add
   `https://claude.com/api/mcp/auth_callback` or ChatGPT's per-server
   `https://chatgpt.com/connector/oauth/{callback_id}` only if observed, as an
   exact constant with the evidence.
3. **Registration volume.** Claude registers a client on every fresh
   connection from Anthropic's egress range (`160.79.104.0/21`). The reuse
   window collapses repeats; if real onboarding still meets the 5-per-source
   limit, raise it deliberately with the measurement.
4. Refresh, revoke, disabled-staff denial and the switch, end to end on the
   actual accounts.

## Provider redirect URIs

| URI | Status |
|---|---|
| `https://claude.ai/api/mcp/auth_callback` | Confirmed in Anthropic's connector authentication docs (3 Nov 2026) |
| `https://chatgpt.com/connector_platform_oauth_redirect` | Confirmed in OpenAI's Apps SDK auth docs (3 Nov 2026) — used when the AS meets RFC 9207, which this one does |
| `https://claude.com/api/mcp/auth_callback` | **Removed (L7)**: not in Anthropic's docs; add only if the provider test observes it |
| `https://chatgpt.com/connector/oauth/{callback_id}` | Documented, but the id is per server; **not accepted** (no prefix matching) |
| `http://localhost:<port>/…`, `http://127.0.0.1:<port>/…` | Confined deployments only (Claude Code, local inspectors) |

## Known limitations

- **Not applied, not provider-tested.** The migration must be applied by the
  lead; no Claude/ChatGPT account has connected. The switch ships OFF.
- **Protocol 2026-07-28** (no `initialize`, per-request metadata) is not
  implemented: such a request gets `400`, which that revision's clients read as
  "fall back to `initialize`". JSON responses only, no SSE.
- **No CIMD.** Claude and ChatGPT fall back to dynamic registration.
- **Registration source is an address.** Without `x-real-ip` (local `next
  dev`, a different host) every request shares one "unknown" source. The
  hashed IPv4 address is pseudonymous, not anonymous (SHA-256 of a 32-bit
  space is reversible by brute force), which is why it is nulled after a day
  and used for nothing but the hourly limit.
- **Strict reuse detection, no grace window.** A client that retries a refresh
  after a lost response (or refreshes twice concurrently) loses the connection
  and must reconnect. Concurrent code redemption likewise revokes the winner.
- **Rate limit is approximate under concurrency**: counts are read, then the
  call runs; simultaneous calls at the 60th can pass together.
- **A failed log insert does not fail the call** (and so does not count
  toward the limit). The log is evidence, not a gate.
- **Smoke Lab accounts are refused at consent only** (their flag lives in the
  JWT claims, which a token call does not have); day-run QA identities are
  refused at consent, at every call and at every refresh.
- **Service-role twins.** Tools read through the service role after the
  screen's check and the session fence against the verified actor, not
  through RLS (option B's documented fallback, §5.2): there is no
  per-connection Supabase session, because holding one would need an
  encryption key. Twins of RLS reads require `readsEveryClass`, so a teacher
  stage will need class-scoped twins.
- **Tokens issued in a race with a revocation** (a rotation that read its
  connection just before another transaction revoked it) can be written
  unrevoked; they open nothing, because every call and every rotation re-reads
  the connection's `revoked_at`.
- **`school_day_summary` "periods without cover"** counts live cover duties
  still needing help; lessons of absent teachers that no duty was created for
  (the admin Today's "missed" count) are not included in M1.
- **One live grant per person and provider.** Redeeming a new consent ends
  the same person's other connection to that provider (`replaced`).
- **Kill switch from a Preview** is refused (every account there is a test
  account and the flag is production's).
- `ai_tool_calls` keeps rows of refused calls too; a purged connection's rows
  keep `connection_id` null.
