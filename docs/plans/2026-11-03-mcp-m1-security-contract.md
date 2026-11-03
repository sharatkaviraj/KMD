# AI connection M0/M1: the security contract as built

**Status: implemented on `feat/mcp-m1`; migration NOT applied; no provider
tested; kill switch ships OFF.** This is the first secure slice of
`docs/plans/2026-11-03-mcp-feasibility.md` (option B, §5.2): One's own
OAuth 2.1 authorization server and a stateless MCP endpoint, read-only
§4.1 tools, admins only (D7), TEST for admins only (D11). Each guarantee
below names the code that enforces it and the test that pins it.

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

## Guarantees

| # | Guarantee | Enforced by | Test |
|---|---|---|---|
| 1 | Tokens and codes are opaque 256-bit CSPRNG values; only SHA-256 hex is stored; no signing keys, secrets or env vars | `domain/crypto.ts`; `ai_tokens.token_hash`, `ai_oauth_codes.code_hash` checks | `oauth.test.ts` "makes 256-bit tokens…", "stores only the code's hash…"; `migration.test.ts` "stores hashes" |
| 2 | PKCE S256 only; plain refused; verifier format checked | `validateAuthorizeRequest`, `handleToken`, `ai_exchange_code` compares S256(verifier) | `oauth.test.ts` "PKCE S256" (RFC 7636 vector), "refuses a wrong verifier…" |
| 3 | Redirect URIs match an allowlist exactly — at registration and again at consent; loopback only on a confined deployment | `domain/redirects.ts`; `handleRegister`; `validateAuthorizeRequest` | `oauth.test.ts` "redirect URIs match exactly" (15 near misses), "refuses a loopback redirect…" |
| 4 | Until client and exact redirect URI are proven, an error is a page in One, never a redirect; after, errors go back with `state` and `iss` | `validateAuthorizeRequest` (`show_error` vs `redirect_error`), consent page | `oauth.test.ts` "shows an error page…", "sends protocol errors back…", "passes state through and adds iss…" |
| 5 | `iss` on every authorization response (RFC 9207), so ChatGPT's stable redirect works and mix-up is caught | `domain/consent.ts`; metadata `authorization_response_iss_parameter_supported` | `oauth.test.ts` "passes state through…", "discovery metadata" |
| 6 | Issuer and resource never follow a forged Host on production; a confined deployment uses only its own Vercel/loopback origin | `canonicalOrigin` (`domain/origin.ts`) | `oauth.test.ts` "names the canonical resource and issuer…", "uses a confined deployment's own origin…" |
| 7 | Codes are single-use, 60 s, bound to client, redirect URI, challenge and resource; a reused code revokes the connection and every token from it; a mismatched or expired code is consumed and its connection ended | `ai_exchange_code` (`select … for update`) | `oauth.test.ts` "treats a reused code as replay…", "refuses an expired code", "refuses a code for another client…"; `migration.test.ts` "decides single use under a row lock…" |
| 8 | Of two concurrent redemptions exactly one is issued tokens; the other is reuse | row lock in `ai_exchange_code`; fake store mirrors it synchronously | `oauth.test.ts` "lets exactly one of two concurrent redemptions win" |
| 9 | Refresh tokens rotate; a used one presented again revokes the whole connection; two concurrent refreshes = one rotation + one replay | `ai_rotate_refresh` (`for update`) | `oauth.test.ts` "rotates refresh tokens…", "treats a used refresh token as replay…", "lets one of two concurrent refreshes rotate…" |
| 10 | Access tokens 15 min; refresh never outlives the 90-day grant; the last access token is capped at the grant's end; the table refuses a longer grant | `ACCESS_TOKEN_TTL_SECONDS`, `ai_connections_lifetime` check, `least(…, expires_at)` | `oauth.test.ts` "never lets a refresh token outlive…", "caps the last access token…"; `migration.test.ts` "caps every grant at 90 days…" |
| 11 | Token endpoint: form-encoded only, each parameter once, RFC 6749 JSON errors, `Cache-Control: no-store`; dead grant = `invalid_grant` | `handleToken`, `readForm`, `oauthError` | `oauth.test.ts` "answers RFC 6749 errors as no-store JSON" |
| 12 | Dynamic registration: public clients only, names cleaned and capped (display only), 30 registrations an hour | `handleRegister`, `ai_register_client` (advisory lock) | `oauth.test.ts` "registration is public-client only…" |
| 13 | RFC 7009 revocation acts only for the client the token was issued to; a refresh token ends the grant | `ai_revoke_token` | `oauth.test.ts` "RFC 7009 revocation" |
| 14 | No/invalid/expired token → 401 with `WWW-Authenticate: Bearer resource_metadata=…, scope="one.read"` (plus `error="invalid_token"` when one was sent); header only, never query; audience = canonical MCP URL | `handleMcp`, `bearerToken`, `liveAccess` | `transport.test.ts` "the MCP endpoint's authentication" (8 tests) |
| 15 | A foreign browser `Origin` → 403 (DNS rebinding); GET/DELETE → 405 `Allow: POST`; no `Mcp-Session-Id`; unsupported `MCP-Protocol-Version` → 400 | `handleMcp`, `allowedRequestOrigin` | `transport.test.ts` "the Streamable HTTP transport" |
| 16 | Every tool call re-runs, in order, nothing cached: token → connection → kill switch → staff → eligibility → TEST/session → permission + scope → arguments → rate limit → run → one log row | `callTool` (`domain/mcp.ts`) | `pipeline.test.ts` (whole file), "re-reads everything on every call", "re-checks the token for each call in a batch" |
| 17 | Kill switch `runtime_flags.ai_connection`: absent, unreadable or off refuses every tool; ships OFF | `store.killSwitchOn`; migration key widened like D-359 | `pipeline.test.ts` "refuses every tool while the kill switch is off…"; `migration.test.ts` "adds the kill switch OFF…" |
| 18 | Staff read per call by the verified auth user with `readCurrentStaff`'s rules (matrix permissions, unknown role → view_only, confinement); missing/inactive/mismatched → 401 and connection revoked | `data/staff.ts` + `ai_staff_for_user`; `callTool` | `pipeline.test.ts` "refuses an inactive staff member…", "…profile is gone or no longer this connection's" |
| 19 | Eligibility is one function at consent and at every call: admins only (D7, one-line `AI_CONNECTION_ROLES` change for teachers); QA/Smoke accounts never | `domain/eligibility.ts` | `pipeline.test.ts` "does not let a non-admin connect or call", "refuses a role demoted…", "with the teacher stage switched on…" |
| 20 | TEST is for admins only (D11), on confined deployments too; session from `pickSessionLabel` via `sessionLabelForActor`, never from arguments; session fence re-checked | eligibility (`test_not_admin` before role), `canAccessSession`, `isTestSessionLabel` check in `callTool` | `pipeline.test.ts` "keeps non-admins out of TEST…", "gives an admin on a confined deployment the TEST session…", "with the teacher stage…" |
| 21 | Each tool runs the screen's own reader through a verified-actor twin that repeats the screen's check (`…As(actor, …)`); service-role twins of RLS reads require `readsEveryClass` | `src/platform/auth/verified-actor.ts`; `absencesOnAs`, `dutiesOnAs`, `registersForDayAs`, `listEnrolmentsAs`, `markStatusesAs`, `attendanceCalendarAs`, `attendanceRulesAs`, `classLabelMapAs`, `listStaffAs`, `boardForActor`, `askedLeaveForActor` | registry scope pin; `pipeline.test.ts` teacher-stage scope/permission refusals |
| 22 | Arguments: strict zod (unknown fields refused), dates only, within −31/+14 days; no argument can name staff, role, session, school or "act as" | `domain/tools.ts` | `pipeline.test.ts` "rejects unknown fields, tampered types and identity arguments"; `registry.test.ts` strict-schema walk |
| 23 | Output is an explicit allowlist per tool, pinned; no reason, note, phone, email, fee, pupil field; reason never even read for `who_is_away` (`withReason: false`) | `domain/projection.ts`, `TOOLS[].output` | `registry.test.ts` "pins each projection", "projects no personal… field", per-tool leak tests |
| 24 | 60 calls/hour and 400/day per staff member, counted from the log | `ai_call_counts`, `callTool` step 8 | `pipeline.test.ts` "limits each staff member…" |
| 25 | One metadata row per call: staff, connection, provider, tool (registry name or `unknown`), outcome, rows, duration — no arguments, names or text; service role only; 180 days | `logToolCall`, `ai_tool_calls` checks, `ai_purge` + job `ai-connection-purge` | `pipeline.test.ts` "logs no argument, name or free text…"; `migration.test.ts` "logs metadata only", purge |
| 26 | All new tables RLS-on with no policy, all grants to anon/authenticated revoked, functions executable by service_role only | migration | `migration.test.ts` |
| 27 | Fail closed: a store or matrix failure answers 503, never a guess | `handleMcp` / `failClosed` | `transport.test.ts` "fails closed with 503…" |
| 28 | Disabling a login, Disconnect (own, D9) and admin Disconnect (any, D9) revoke connections; the switch and other people's connections need the admin role and a non-test account | `changeStaffAuthority` → `revokeStaffAiConnections`; `settings/ai-connection/actions.ts`; `preferences/ai-connection-actions.ts` | per-call refusal is the authority (18); actions re-check owner/permission |
| 29 | Consent stays behind sign-in with the full query preserved; Approve/Deny re-validate from the raw query, not rendered fields | proxy (not in `PUBLIC_PREFIXES`); `app/mcp/authorize/actions.ts` | `public-routes.test.ts` "still sends … the AI consent page to /login" |
| 30 | Card states come only from One's records; never "connected and working" | `domain/card.ts` | `card.test.ts` |

## Provider redirect URIs

| URI | Status |
|---|---|
| `https://claude.ai/api/mcp/auth_callback` | Confirmed in Anthropic's connector authentication docs (3 Nov 2026) |
| `https://chatgpt.com/connector_platform_oauth_redirect` | Confirmed in OpenAI's Apps SDK auth docs (3 Nov 2026) — used when the AS meets RFC 9207, which this one does |
| `https://claude.com/api/mcp/auth_callback` | **Not in Anthropic's docs**; kept per the lead's brief; confirm or remove in the M0 provider test |
| `https://chatgpt.com/connector/oauth/{callback_id}` | Documented, but the id is per server; **not accepted** (no prefix matching). Add the exact URI if the provider test shows ChatGPT uses it |
| `http://localhost:<port>/…`, `http://127.0.0.1:<port>/…` | Confined deployments only (Claude Code, local inspectors) |

## Known limitations

- **Not applied, not provider-tested.** The migration must be applied by the
  lead; no Claude/ChatGPT account has connected. The switch ships OFF.
- **Protocol 2026-07-28** (no `initialize`, per-request metadata) is not
  implemented: such a request gets `400`, which that revision's clients read as
  "fall back to `initialize`". JSON responses only, no SSE.
- **No CIMD.** Claude and ChatGPT fall back to dynamic registration; Claude
  registers a client per fresh connection. Unused clients are purged after a
  day; registrations are capped at 30/hour globally, so a flood can delay a
  real registration (not open anything).
- **Strict reuse detection, no grace window.** A client that retries a refresh
  after a lost response (or refreshes twice concurrently) loses the connection
  and must reconnect. Concurrent code redemption likewise revokes the winner.
- **Rate limit is approximate under concurrency**: counts are read, then the
  call runs; simultaneous calls at the 60th can pass together.
- **A failed log insert does not fail the call** (and so does not count
  toward the limit). The log is evidence, not a gate.
- **Smoke Lab accounts are refused at consent only** (their flag lives in the
  JWT claims, which a token call does not have); day-run QA identities are
  refused at both. Neither can hold a grant without consent.
- **Service-role twins.** Tools read through the service role after the
  screen's check against the verified actor, not through RLS (option B's
  documented fallback, §5.2): there is no per-connection Supabase session,
  because holding one would need an encryption key. Twins of RLS reads require
  `readsEveryClass`, so a teacher stage will need class-scoped twins.
- **Under the fees bridge** class names and sessions are roster-projection
  reads; `projection-fetch.ts` now accepts the verified actor from an
  `AsyncLocalStorage` context that only `src/modules/mcp/data/runtime.ts`
  sets, after the whole pipeline. Shared 60–300 s data caches (class labels,
  calendar, session facts) are the screens' own and are reused.
- **`school_day_summary` "periods without cover"** counts live cover duties
  still needing help; lessons of absent teachers that no duty was created for
  (the admin Today's "missed" count) are not included in M1.
- **Replacing a connection.** A new consent ends the same person's earlier
  live connection to the same provider (`replaced`): one Claude grant per
  person.
- **Kill switch from a Preview** is refused (every account there is a test
  account and the flag is production's).
- `ai_tool_calls` keeps rows of refused calls too; a purged connection's rows
  keep `connection_id` null.
