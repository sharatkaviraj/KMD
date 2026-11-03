# Teacher AI connection (M01–M03): feasibility and permission design

**Status: design only, 3 November 2026.** Nothing here is built, migrated,
configured or bought. This is the "provider feasibility and permission design"
gate that `docs/plans/2026-11-03-review-plan-implementation.md` puts before
M01–M03 ("MCP after"). It ends with the decisions only the owner can make
(§9). Every provider statement in §2 carries its source and the date it was
read; where the official page could not be read, it says so.

## 1. The short answer

- **Claude: feasible now, for every plan, including Free.** A remote MCP
  server added by URL ("custom connector") works on Free (one connector),
  Pro, Max, Team and Enterprise, on the web, desktop and mobile apps, with each
  teacher signing in to One with their own account. Teachers can add it
  themselves on Free/Pro; on a Team plan only an Owner adds it and each member
  then connects.
- **ChatGPT: feasible on a paid workspace; unproven for personal accounts.**
  OpenAI's developer docs confirm custom MCP servers on ChatGPT on the web,
  with write actions that need confirmation by default. Which personal plans
  get it is contradictory in what could be read, and a dated third-party test
  shows a Plus account failing to list tools. Do not offer "Connect ChatGPT" to
  teachers until a Plus account and a Business workspace have each been tested.
- **There is no one-tap install on either.** The best Claude can do is a
  "Connect Claude" button in One that opens Claude's *Add custom connector*
  dialog already filled in; the teacher confirms, signs in to One, and
  approves. No equivalent prefill link was found for ChatGPT.
- **Free-plan writes are not promised.** Claude's docs place no plan limit on
  write tools, but nothing was tested. ChatGPT's personal plans may be
  read-only or not work at all.
- **Identity reuses One's sign-in, through One's own small OAuth server.**
  Supabase Auth now has an OAuth 2.1 server (beta), but its tokens are the
  teacher's ordinary Supabase session as far as the database is concerned,
  with no custom scopes and no binding to One's MCP address. The recommendation
  (§5.2) is that One issues its own narrow tokens after the teacher signs in
  with their usual One password, so what Anthropic or OpenAI holds opens the
  AI tools and nothing else. Every call re-reads the teacher's staff profile,
  permissions and class scope from One; nothing about identity, role, class or
  session is taken from the AI's request.
- **The biggest open question is privacy, not technology.** Anything a tool
  returns goes to Anthropic or OpenAI. On personal Free/Pro accounts the
  school cannot control whether that data trains models or how long it is
  kept. Pilot with admin accounts and aggregate answers first; pupil names go
  out only after the owner decides (§9, D2–D4).

## 2. What the providers support (read 3 November 2026)

**Key:** *Confirmed* = read on the provider's own documentation page.
*Reported* = the official page could not be read (it returned 403 or a
human-verification check); the claim comes from search-engine extracts of
that page or from third parties and must be checked by hand before it is
relied on. *Unknown* = no source found.

### 2.1 Claude (Anthropic)

| # | Claim | Status | Source |
|---|---|---|---|
| C1 | Custom connectors (a remote MCP server added by URL) work on Free, Pro, Max, Ultra, Team and Enterprise; **Free is limited to one** | Confirmed | [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted.md); [support article 11175166](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-MCP) ("Updated this week") |
| C2 | The same connector works in claude.ai, Claude Desktop, the mobile apps and Cowork; "the same connector infrastructure backs all of them" | Confirmed | [Build an MCP server for Claude](https://claude.com/docs/connectors/building/index.md); support article 11175166 |
| C3 | Adding a connector is documented on the web (*Customize › Connectors*); **adding one from the mobile app is not documented** | Unknown | add-unlisted (web steps only) |
| C4 | Team/Enterprise: only Owners and Primary Owners add a custom connector (Enterprise also a custom role with library management); **each member then connects with their own account** | Confirmed | add-unlisted; support article 11175166 |
| C5 | Per-user OAuth; PKCE S256 on every request; a `401` with `WWW-Authenticate: Bearer resource_metadata=…` starts sign-in; RFC 9728 protected-resource metadata whose `resource` equals the server URL; RFC 8414 or OIDC discovery on the authorization server; follows MCP authorization specs 2025-03-26, 2025-06-18, 2025-11-25 | Confirmed | [Authentication for connectors](https://claude.com/docs/connectors/building/authentication.md); building/index |
| C6 | Client registration: a Client ID Metadata Document (CIMD) only if the authorization server advertises `client_id_metadata_document_supported: true` **and** `none` in `token_endpoint_auth_methods_supported`; otherwise Dynamic Client Registration (DCR), which "register[s] a new client on every fresh connection"; or a client ID the admin enters | Confirmed | authentication.md |
| C7 | Redirect URI for web, desktop, mobile and Cowork: `https://claude.ai/api/mcp/auth_callback`; Claude Code uses a loopback redirect on any port | Confirmed | authentication.md |
| C8 | Refresh: Claude refreshes on a `401` and up to five minutes before expiry; needs `invalid_grant` for a dead refresh token; refresh tokens must be rotated for public (DCR/CIMD) clients; asks for `offline_access` if the server lists it; 10 s limit on discovery/registration/token endpoints, 30 s on refresh; no `client_credentials` grant | Confirmed | authentication.md |
| C9 | A static request-header credential (one API key for the whole organisation) is beta for a limited set of organisations and is explicitly "not a person's" credential — **unusable for per-teacher identity** | Confirmed | authentication.md |
| C10 | Server must be reachable on the public internet; Anthropic's traffic comes from `160.79.104.0/21` | Confirmed | authentication.md |
| C11 | Limits on claude.ai and Desktop: tool result ~150,000 characters; 240 s per tool call. Resource subscriptions and sampling are not supported | Confirmed | building/index |
| C12 | Tool annotations: every directory tool needs a `title` and `readOnlyHint: true` or `destructiveHint: true`; "These determine auto-permissions in Claude. Read-only tools can run without per-call confirmation, and destructive tools always prompt." Read and write must be separate tools | Confirmed (stated for directory review; custom connectors run on the same infrastructure) | [Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria.md); [Directory vs custom](https://claude.com/docs/connectors/building/directory-vs-custom.md) |
| C13 | Users can set a tool to **Blocked**, turn a connector off per chat, and choose "Always allow"; in Research mode Claude may call tools without further approval, so Anthropic advises disabling write tools there | Confirmed | add-unlisted; support article 11175166 |
| C14 | **Install link** for a custom connector: `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=…&connectorUrl=…` opens the dialog prefilled; "The user reviews the values and confirms before anything is added." Owners have the same link under `admin-settings/connectors` | Confirmed | directory-vs-custom |
| C15 | Directory listing is for public discovery and needs Anthropic review; a private school server stays a custom connector | Confirmed | directory-vs-custom |
| C16 | No documented restriction of write tools by plan; **not tested** | Unknown | — |
| C17 | Commercial products (Team, Enterprise, API): inputs and outputs not used for training by default; a thumbs-up/down stores that conversation up to 5 years (Owners can switch off *Rate chats*); feedback "does not include raw content from connectors" unless copied into the conversation | Confirmed (page dated 18 Aug 2026) | [Is my data used for training?](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-training) |
| C18 | Free, Pro, Max, Ultra: Anthropic trains on the account's data **when the user's setting is on**; retention 5 years with the setting on, 30 days with it off (stated on the Claude Code data page); commercial standard retention 30 days | Confirmed for training choice; retention figures are from the Claude Code page | [Data usage](https://code.claude.com/docs/en/data-usage.md) |
| C19 | Prices: Pro $20/month ($17 annual); Team Standard seat $25/month ($20 annual), 2–150 seats; admin controls for connectors only on Team and Enterprise | Confirmed (USD; Indian pricing and GST not checked) | [claude.com/pricing](https://claude.com/pricing) |

### 2.2 ChatGPT (OpenAI)

| # | Claim | Status | Source |
|---|---|---|---|
| G1 | A custom MCP server can be added and its tools used in ChatGPT: "Use ChatGPT on the web"; "Workspace permissions and security restrictions, including Lockdown, apply"; "Write actions by default require confirmation"; tools without `readOnlyHint` "are treated as write actions" | Confirmed | [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server.md) |
| G2 | **Which plans:** the Help Center article *Developer mode and MCP apps in ChatGPT* reportedly says full MCP (including write actions) is a beta for **Business, Enterprise and Edu**, on the web; on Business, admins/owners turn developer mode on for themselves; on Enterprise/Edu admins can grant it by role; only admins/owners publish to the workspace | Reported — the article returned 403 and a human-verification page | [help.openai.com 12584461](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) |
| G3 | Plus/Pro: OpenAI Developers announced full MCP tools with write actions in developer mode in September 2025, and third-party write-ups of that launch name Plus and Pro; a third-party test on 20 Aug 2026 found a **Plus** account completed OAuth but ChatGPT never listed the tools, and records OpenAI's developer guide and Help Center disagreeing on plans | Reported / conflicting | [OpenAI Developers on X](https://x.com/OpenAIDevs/status/1965807401745207708); [third-party test](https://github.com/jmrGrav/mcp-hugo-server-go/wiki/Pitfall-ChatGPT-Plus-MCP-Availability) |
| G4 | Free plan custom MCP; mobile apps; a prefilled install link | Unknown | — |
| G5 | OAuth: OAuth 2.1 per the MCP authorization spec; S256 must be advertised in `code_challenge_methods_supported`; protected-resource metadata; OAuth or OIDC discovery; CIMD preferred, else DCR or a predefined client; echo `resource` throughout; the server must check `aud`/`resource`, `exp`/`nbf` and required scopes on every call | Confirmed | [Authentication](https://developers.openai.com/apps-sdk/build/auth) |
| G6 | Redirect URI: `https://chatgpt.com/connector_platform_oauth_redirect` when the authorization server meets RFC 9207 issuer identification, otherwise `https://chatgpt.com/connector/oauth/{callback_id}` shown on the server's management page | Confirmed | apps-sdk/build/auth |
| G7 | Without `offline_access`, ChatGPT "may lose access after the original authorization expires" | Reported (Help Center extract) | help.openai.com 12584461 |
| G8 | Annotations `readOnlyHint`, `destructiveHint` (host asks for explicit approval), `openWorldHint`, `idempotentHint`; "These hints only influence how ChatGPT or Codex frames the tool call"; the server must enforce its own authorization | Confirmed | [Reference](https://developers.openai.com/plugins/reference.md) |
| G9 | Security guidance: assume prompt injection reaches the server; validate inputs server-side; require human confirmation for irreversible operations; redact PII before logging; include only the data the prompt needs | Confirmed | [Security & Privacy](https://developers.openai.com/plugins/guides/security-privacy.md) |
| G10 | Business, Enterprise, Edu and API: not used for training by default. Personal Free, Plus, Pro: data sharing on by default; the user can switch off *Improve the model for everyone* | Reported (Help Center extracts) | [help.openai.com 8983130](https://help.openai.com/en/articles/8983130-what-if-i-want-to-keep-my-history-on-but-disable-model-training), [5722486](https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance) |
| G11 | ChatGPT Business: $25 per user per month ($20 annual), from 2 seats | Reported (search extract; the page returned 403) | [openai.com/business/pricing](https://openai.com/business/pricing/) |
| G12 | OpenAI's developer docs now call these "plugins" and the surface "ChatGPT Work"; product names are moving | Confirmed | [Quickstart](https://developers.openai.com/plugins/quickstart.md) |

### 2.3 Supabase Auth as the OAuth server

| # | Claim | Status | Source |
|---|---|---|---|
| S1 | OAuth 2.1 server "is in beta and available on all Supabase plans"; no separate charge; OAuth users count toward MAU | Confirmed | [Getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started) |
| S2 | Authorization code with PKCE; refresh tokens "may be rotated"; access-token `expires_in` default 3600 s | Confirmed | [OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows) |
| S3 | Public and confidential clients; DCR supported, off in the sample config (`allow_dynamic_registration = false`); **CIMD not documented** — so Claude would fall back to DCR | Confirmed (CIMD: not found) | getting-started; [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) |
| S4 | The app hosts the consent screen: `supabase.auth.oauth.getAuthorizationDetails` / `approveAuthorization` / `denyAuthorization`; the authorization path is set relative to the Site URL | Confirmed | getting-started |
| S5 | Discovery at `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`; advice: always require explicit user approval, validate redirect URIs, monitor registered clients | Confirmed | mcp-authentication |
| S6 | Tokens are ordinary Supabase JWTs: `sub`, `role: authenticated`, **`aud: authenticated`**, `client_id`, `session_id`, `exp`; JWKS for verification; with the `openid` scope, HS256 projects cannot mint ID tokens | Confirmed | [Token security](https://supabase.com/docs/guides/auth/oauth-server/token-security); getting-started |
| S7 | Scopes are `openid`, `email`, `profile`, `phone` only — "Custom scopes are not currently supported" and "Scopes control OIDC data, not database access"; resource indicators (RFC 8707) not mentioned | Confirmed | oauth-flows; token-security |
| S8 | RLS applies to OAuth tokens automatically; `auth.jwt() ->> 'client_id'` is null for a direct session; a restrictive policy can shut OAuth clients out of a table; custom access-token hooks run "for all token issuance" | Confirmed | token-security |
| S9 | `revokeGrant(clientId)` (the signed-in user's own grant): "all active sessions and refresh tokens for that client are immediately invalidated"; whether an access token already issued stops working before `exp` is not stated; `listGrants()` exists in supabase-js (One has 2.116) | Confirmed / unknown for live access tokens | oauth-flows; [Dart reference](https://supabase.com/docs/reference/dart/oauth-server-revokegrant) |
| S10 | Supabase's MCP guide expects you to build the MCP server; for Next.js, Vercel's `mcp-handler` 2.x gives a Streamable-HTTP route handler, `withMcpAuth` (the `401` challenge) and the RFC 9728 metadata route, and is resource-server only (needs `@modelcontextprotocol/server` ^2 and zod ^4.2; One has zod 4.6) | Confirmed | mcp-authentication; [vercel/mcp-handler](https://github.com/vercel/mcp-handler) |

### 2.4 What this means for the review plan's gates

| Gate (review plan) | Answer |
|---|---|
| Custom/remote MCP on free and paid plans | Claude: yes, Free limited to one connector (C1). ChatGPT: Business/Enterprise/Edu reported, personal plans unproven (G2–G4) |
| Mobile clients | Claude: using it on mobile, yes (C2); adding it on mobile, undocumented (C3). ChatGPT: unknown (G4) |
| OAuth | Both require standard per-user OAuth 2.1 with PKCE and discovery (C5–C8, G5–G7). One has no OAuth server today |
| Tool writes | Claude: write tools supported, destructive tools always prompt (C12); free-plan writes untested (C16). ChatGPT: confirmation by default (G1); plan rules unclear (G2–G3) |
| Distribution | Claude: install link prefill for individuals, Owner-added for Team (C4, C14). ChatGPT: workspace publishing by admins (G2, reported) |
| One-tap | **No.** Closest: One's button → prefilled Claude dialog → confirm → sign in to One → approve |

## 3. Shape of the connection

```mermaid
flowchart LR
    T["Teacher in Claude or ChatGPT"] -->|"tool call + bearer token"| M["One /api/mcp<br/>(route handler, same deployment)"]
    M --> V["verify token, read connection row"]
    V --> S["staff_profiles → effectivePermissions → classScopeFor"]
    S --> F["the same server function the One screen uses"]
    F --> DB[("One database, vppsone")]
    M --> L[("ai_tool_calls: tool, outcome, counts")]
    T -.->|"sign-in and consent"| A["One consent page"]
    A --> AS["One's authorization server<br/>(or Supabase OAuth 2.1, §5.2)"]
```

- **One deployment, one route.** The MCP endpoint is a Node route handler in
  One (`/api/mcp`, `runtime = "nodejs"`), not a new worker. It calls the same
  module functions and permission checks as One's pages, so "native One and MCP
  enforce the same boundaries" is a property of the code, not of discipline.
  `docs/cutover/MCP-AND-NOTION.md` designed a separate read-only *fees* worker
  for the owner's money questions; that is a different product and is not
  needed for teachers (D10).
- **No fee tools.** Fees stays the financial authority (coexistence plan). The
  teacher connection exposes no fee read or write. The owner's existing Fees
  connector keeps answering money questions.
- **Optional by construction.** No page, layout or bundle imports the MCP code;
  switching it off (§5.5) changes nothing a teacher sees in One except the
  connection card.

## 4. What to expose first

Each tool is a thin wrapper over the function the One screen already calls,
with the same permission and scope check, returning a **projection**: a
field list fixed in code and pinned by a test, so a function that returns more
(phone, date of birth, photo path) never passes it through. Paths are as of
`d6c44cb7`.

### 4.1 Reads for the admin pilot (level 0, §6.1)

| Tool | Reuses | Check it keeps | Returns |
|---|---|---|---|
| `school_day_summary` | `loadBoard` / `readBoard` (`src/vx/screens/admin/data.ts:188-266`) | admin Today guard (`src/app/(app)/page.tsx:49`); `readsEveryClass` | per class: marked / unmarked; counts away; periods without cover |
| `who_is_away` (date) | `absencesOn` (`src/modules/substitutions/data/absences-repo.ts:35-62`) | any active staff; the **reason is never returned**, even to `substitutions:manage` | staff name, whole/half day |
| `cover_plan` (date) | `dutiesOn` (`src/modules/substitutions/data/cover-repo.ts:115-128`) | `substitutions:view` | period, class label, absent teacher, substitute |
| `pending_leave` | `askedLeave` (`admin/data.ts:87-102`) | `substitutions:manage` (as loaded at :718) | staff name, dates; no reason |

### 4.2 Reads for teachers (own scope)

| Tool | Reuses | Check it keeps | Returns |
|---|---|---|---|
| `my_day` | `loadHome` (`src/vx/screens/teach/data.ts:441-712`), `periodsOn` (`src/modules/attendance/data/teaching-repo.ts:118-152`), `myDutiesOn` (`src/modules/substitutions/data/duty-repo.ts:88-104`), `myLeaveRows` (`teach/data.ts:213-222`) | `attendance:view` (`src/app/(app)/teach/page.tsx:14`); own rows only | periods, rooms, own cover duties, own leave, which of own registers are unmarked |
| `my_registers` (date) | `ownClassIds` (`teaching-repo.ts:32-53`) + `registersForDay` (`src/modules/attendance/data/attendance-repo.ts:632-646`) | RLS (`attendance:view`, own or all classes) | counts only |
| `my_tasks` | `listTeacherTasks(false)` (`src/modules/teacher-tasks/data/repo.ts:126-158`) | `assertStaff`; assignee only | title, due date, status |
| `staff_notices` | `staffNotices` (`teach/data.ts:85-116`) | none inside today — the tool adds the active-staff check | title, date, text |
| `marks_status` | `marksLinks` (`teach/data.ts:1031-1093`) | own assignments | entered / total / submitted per subject; **never the no-login marks link**, which works as a password |
| `class_roll` (level 1 only) | `classRoll` (`attendance-repo.ts:54-109`) | `classScopeFor` (`teaching-repo.ts:95-101`) — callers check scope today, so the tool must | roll number, display name |

### 4.3 Not exposed

`loadStudent` / `classInsight` (`teach/data.ts:308-398, 961-1006`: parents'
names, phone, date of birth, photo path, notes), `searchStudents`
(`src/modules/students/data/directory-repo.ts:62-179`: phones; teachers lack
`students:view` anyway), `feeStanding`
(`src/modules/students/data/student-repo.ts:106-150`), anything under
`src/modules/fees/`, the no-login task and marks links (`/t`, `/w`).

### 4.4 Writes to add later

| Write | Server path today | Permission and scope | Idempotency | Gap before the AI may call it |
|---|---|---|---|---|
| Attendance, own class | `saveRegisterVx` (`src/vx/screens/teach/actions.ts:67-166`) → `saveAttendanceAction` checks (`src/app/(app)/teach/actions.ts:81-152`) → RPC `save_attendance_register` | `attendance:mark` **and** class teacher/assistant authority (`src/modules/attendance/domain/attendance.ts:254-283`, re-checked in SQL); session writable | `command_id` unique; `id_reused`; expected revision | None in the data layer. The summary must say that parents of absent pupils get an absence message **queued** (the screen's confirm sheet shows it) |
| Teacher asks for own leave | `requestLeaveVx` (`teach/actions.ts:215-241`); `previewLeaveVx` (:253-271) | own id only | **none** — a plain insert, no unique key | A command id and unique index (a `vppsone` migration) first |
| Admin marks a teacher away | cover command intent `absence` (`src/app/(app)/substitutions/actions.ts:77-155`) | `substitutions:manage`; SQL re-checks active staff | `cover_commands.id`; `id_reused`; stale day revision | `arrangeDay` computes and commits in one go (`src/modules/substitutions/data/arrange-day.ts:227-332`); the prepare step needs its compute half on its own |
| Cover assignment | `arrangeDay` → `commitCoverCommand` (`src/modules/substitutions/data/cover-repo.ts:215-231`) → `commit_cover_command` | `substitutions:manage` | as above | as above; the summary must say substitutes are notified after saving |
| Substitution from a photo, list or voice note | the same cover command — the provider reads the photo; One receives rows | as above | as above | every row must match the timetable; unmatched rows are returned, never guessed |
| Pupil details (review plan: "class teacher may update permitted details") | today only the office opens a collection request (`collection_fields`); the teacher's answers become pending submissions the office accepts (`accept_submissions`) | `collection:*`; fields are data, not code | `record_commands` | **No class-teacher-started request exists.** Through the AI: draft answers to an open request only (D13) |

Not on the list: leave decisions (`decideLeaveAction` writes up to 14 days of
cover at once — keep it in One), marks (not asked for in the review plan).

## 5. Identity

### 5.1 The rule

The AI's request supplies **only** a bearer token and tool arguments. Staff
identity, role, permissions, class scope, TEST/real session and the academic
session label are all derived on the server, on every call, from One's own
tables. No tool argument names a staff member, a role, a session label or
"act as".

### 5.2 The authorization server: two options

Today One has no OAuth server and no bearer-token sign-in for staff. Identity
comes only from the Supabase cookie (`getCurrentStaff`,
`src/platform/auth/current-staff.ts:237`); staff sign in with email and
password; no OAuth or JWT library is installed. Both options keep that
sign-in for the consent step: the teacher signs in to One as usual and
approves on a One page.

| | A. Supabase OAuth 2.1 server (beta) | B. One's own small authorization server |
|---|---|---|
| What it is | Turn on *Authentication › OAuth Server* on wtgx; One hosts the consent page and calls `approveAuthorization` (S4) | Next.js routes in One for discovery metadata, `/authorize`, `/token`, DCR and CIMD |
| What Anthropic or OpenAI holds | A refresh token for a Supabase session of that teacher. Through Supabase's Data API it does whatever the teacher's browser session can, under RLS, until revoked (S6, S8) | A token that opens One's MCP route only, for the scopes granted |
| Scopes and audience | None (S7) | `one.read`, `one.attendance.write`, …; bound to One's MCP URL through the `resource` parameter ChatGPT echoes (G5) |
| Containing a leaked token | Restrictive `vppsone` policies refusing writes when `client_id` is set; fee tables cannot take a policy (rule 2), so it must be shown that the token reads nothing in `public`. A hook could demote the token's `role` instead, but it runs on **every** staff sign-in (S8) and would also stop the RLS reads below | Not needed |
| How tool reads keep the screens' RLS | A request-scoped Supabase client built from the bearer token; `createClient()` reads cookies only today | One keeps a Supabase session per connection, minted at consent through the admin `generateLink` + `verifyOtp` path QA sign-in already uses, refresh token encrypted at rest; fallback: service role with an explicit actor plus a tested scope rule per tool. `my_permissions()` reads `auth.uid()`, so either way it needs a real user token or a service-role twin |
| Disabled staff | Supabase never bans disabled staff, so their token stays valid; RLS helpers and the per-call check refuse them | Per-call check |
| Revocation | `revokeGrant` ends sessions and refresh tokens (S9); a live access token may last an hour, so the route must also check `session_id` per call | Delete the row: the next call fails |
| Claude registration | DCR only (S3): a new client on every fresh connection (C6) | CIMD (Claude's preferred) and DCR |
| Code to own | Consent page, connection table, policies | Plus the authorization and token endpoints, PKCE, refresh rotation, redirect checks, CIMD fetching with SSRF limits, the held session |
| Effort | ~4 days | ~10–12 days |
| Dependency | A beta feature switched on in the production project | None new |

**Recommendation: B.** What Anthropic or OpenAI holds should open the AI
tools and nothing else — the "read-only by construction, not by habit" rule
`docs/cutover/MCP-AND-NOTION.md` set for the fees worker. Supabase's server is
beta, has no scopes or audience, and containing its tokens means new
policies across `vppsone`, none possible on fee tables, or a hook on every
staff sign-in. B costs about a week more and changes no production auth
setting. A stays documented as the fallback. The resource side (§5.3) is the
same under either.

### 5.3 Every call, in order

1. Verify the token: a hash lookup of One's opaque token, unexpired and
   issued for One's MCP URL (B); under A, the JWKS signature, `exp` and a
   `client_id`.
2. Load the connection row (`vppsone.ai_connections`: staff, provider,
   client id, created, last used, revoked). Missing or revoked → `401`.
3. Check the kill switch (§5.5). Off → a tool error that says the school has
   switched the AI connection off.
4. Load the staff profile by auth user id through the same reader
   `getCurrentStaff` uses — today `readCurrentStaff` reads the cookie and is
   cached per request (`current-staff.ts:108-188`), so it needs a variant that
   takes the verified user — including its confinement rule
   (`current-staff.ts:195-204`). `is_active` false, or not eligible for the
   connection → `401`, and the connection is marked revoked. (`is_active` is
   the only state: "left the school" is a reason label recorded when an admin
   disables someone.)
5. `effectivePermissions` for the role; the tool's required permission must be
   held. The tool's scope rule runs (`classScopeFor` for class tools,
   `readsEveryClass` for school-wide ones); arguments are intersected with
   that scope, and anything outside it is refused, not filtered silently.
6. TEST isolation: a test account sees only TEST sessions (the
   `test-session-access` rule); on a confined deployment every account is a
   test account (`isConfinedDeployment`); production-ness comes from
   `readEffectiveEnvironment`. Session label from `pickSessionLabel()`, never a
   sort (rule 3a).
7. Run the same server function the One screen runs; log one row (§6.3).

Nothing in steps 2–6 is cached across calls, so a change made in One takes
effect on the teacher's next AI request.

**Route plumbing.** The proxy sends any cookie-less request outside
`PUBLIC_PREFIXES` (`src/platform/supabase/middleware.ts:84-96`) to `/login`
with a 307, so `/api/mcp`, the `/.well-known/oauth-*` documents and the token
endpoint must join that list and answer `401` themselves (Claude requires the
`401`, C5); `tests/public-routes.test.ts` holds the list. Server actions have
no common authorization wrapper — each calls `assertPermission` /
`assertStaff` (`current-staff.ts:315-339`) — so the MCP tool registry is the
wrapper: each entry names its permission, scope rule, the function it calls
and its projection, and a test walks the registry.

### 5.4 Lifecycle

| Event | Effect |
|---|---|
| Teacher clicks *Disconnect* in One | Connection revoked; next call `401`; the provider asks them to sign in again |
| Teacher removes the connector in Claude/ChatGPT | The provider drops its token; One cannot see this, so One's card keeps saying "allowed" until expiry or *Disconnect* |
| Admin disables the staff member (`changeStaffAuthority`, `src/app/(app)/staff/vx-actions.ts:192-208`) | Step 4 refuses the next call; that action should also revoke their connections. Supabase does not ban disabled staff, so One's check is the one that counts |
| Role or class-teacher assignment changes (`class_teachers`, edited under `academics:manage`) | Next call uses the new permissions and scope: `classScopeFor` is computed per call, never cached |
| Access token lifetime | 15 minutes (B); Supabase's default would be 1 hour (S2) |
| Refresh token | Rotated on use; a reused old one revokes the connection (B) |
| Connection lifetime | Re-consent after 90 days (D8) |
| TEST account | May connect; sees TEST-2026-27 only — this is how QA tests the connection on production |
| Lost phone | The teacher or an admin presses *Disconnect* in One |

### 5.5 Switches and limits

- A `runtime_flags` key `ai_connection` (the table's key check needs a
  migration to accept it, as D-359 did for its key), read per call. Off stops
  every tool at once without deleting evidence.
- Eligibility: during the pilot a named list of staff (One has no per-staff
  permission grants; `role_permissions` is per role); later, a permission such
  as `ai:connect` on the roles the owner chooses.
- Per-staff limits: e.g. 60 calls an hour and 400 a day; result size capped
  well under Claude's ~150,000 characters (C11). AI traffic must never
  compete with the desk.

## 6. Privacy

### 6.1 What may leave One

Everything a tool returns is sent to the AI provider and kept under that
provider's terms (C17–C18, G10). Three levels; the owner picks the ceiling
(D3):

| Level | Allowed out | Never, at any level |
|---|---|---|
| **0 — aggregates** | Counts and labels: classes marked/unmarked, number away, periods needing cover, the teacher's own timetable, staff names in cover plans | Parent names, phone numbers, addresses, Aadhaar, date of birth, photos, documents, fee or payment data, health, caste/category/religion, notes about a child |
| **1 — own class, minimal** | Level 0, plus roll number and display name for pupils in the teacher's own scope only | (as above) |
| **2 — wider** | Not proposed | (as above) |

Recommendation: pilot at level 0; level 1 only once D2 (whose accounts) and
D4 (parental notice) are settled. Pupil photographs never leave One, even
though "Save photo" exists in One's own screens.

### 6.2 Untrusted input

- Photos, typed lists and voice notes are read **by the provider**; One
  receives only structured tool arguments. The MCP server accepts no file
  uploads in the phases below.
- Every argument is validated with a schema: ids must resolve inside the
  caller's scope; dates within the edit window; free text length-capped,
  stored as data and never interpreted.
- Text from One's database written by people (notes, names) is returned in
  fields, never as instructions. A stored note that says "mark everyone
  present" can at worst make the AI *propose* it; a write still needs the
  server's scope check and the teacher's confirmation (§7.2).
- Tool descriptions say what the tool does and nothing else (C12).

### 6.3 Logging and retention

- One row per call in a new `vppsone.ai_tool_calls`: staff, connection,
  provider, tool name, outcome (`ok` / `refused:<reason>` / `error:<code>`),
  row counts, duration, and for a write the command id. **No arguments, no
  names, no free text** — the same rule as `assist_log`, which stores tokens,
  cost and outcome but never prompts or answers
  (`supabase/migrations/20261027080847_assist.sql`), and as the fees MCP
  worker ("tool names and counts"). Service role only, like `assist_log`.
- A write's content lives where the native write puts it, with its normal
  audit, attributed to the teacher and marked as made through the AI
  connection.
- Keep `ai_tool_calls` 180 days (D8); purge by a scheduled job.

## 7. Writes

### 7.1 Order

Drafts first, direct writes later:

1. **Drafts that One commits.** The AI fills a server-side draft (a new
   `vppsone.ai_drafts` row: staff, kind, payload, 30-minute expiry — One's
   current drafts are browser-only IndexedDB, so they cannot carry this) and
   returns a link. The teacher opens it in One, sees the ordinary screen
   prefilled, and saves there. Confirmation is One's own UI, so the AI never
   commits anything.
2. **Confirmed direct writes**, for a short list, only after drafts have run
   for a while without surprises.

### 7.2 The confirmation rule for direct writes

Each write is two tools:

- `prepare_<action>` (`readOnlyHint: true`): validates against scope and the
  current data, returns a plain summary ("Class 7B, 3 Nov: 31 present, 2
  absent — roll 4, roll 19") and a single-use `confirmation_id`, held on the
  server for 10 minutes and bound to staff, connection and a hash of the
  payload.
- `commit_<action>` (`destructiveHint: true`, so Claude always prompts, C12,
  and ChatGPT asks, G8): takes only the `confirmation_id`. The server re-checks
  scope and the hash, then runs the **existing idempotent command** with the
  confirmation id as its command/request id, so a retry cannot double-save.

The tool description tells the AI to show the summary and wait for the
teacher's yes; the host prompt is a second layer; the server-side binding is
the one that holds whatever the AI does.

### 7.3 Never through the connection

Fee reads or writes, parent or staff messages (WhatsApp sends), deletions,
staff/role/permission changes, settings, imports, raw SQL or any generic
query or edit tool, documents and photographs, anything outside the caller's
scope, anything across the TEST/real boundary.

## 8. Phased build plan, effort and running cost

Effort is for one developer working in this repo with an AI agent, in working
days, excluding the owner's own testing.

| Phase | Scope | Gate to start | Effort |
|---|---|---|---|
| **M0 Spike** | Preview deployment only (confined: every account a test account, TEST data only): `/api/mcp` with one read tool and B's skeleton using short-lived signed tokens, so no table and no migration on wtgx. Test Claude Free, Pro (and Team if the school has one) on web and mobile, ChatGPT Plus and Business; refresh; revoke; disabled staff. Anthropic must reach the Preview URL (`160.79.104.0/21`, C10), which Vercel deployment protection may block. Record the results in §2 | D1, D11 | 3–4 |
| **M1 Read-only admin pilot** | B in full (§5.2) with consent page, `ai_connections`, `ai_tool_calls`, kill switch and the public-route changes (§5.3); the §4.1 tools for named admins; per-tool parity tests (the MCP tool refuses exactly what the screen refuses); architecture tests (no fee client under the MCP tree, every tool in the registry, projections pinned); Claude only | M0 passed; D2, D3, D5 | 12–16 |
| **M2 Teacher reads** | §4.2 tools; *AI connection* card in One with Connect Claude (install link, C14), honest status (§8.1), Disconnect; strings in `src/messages/setup.ts`; limits | M1 has run ≥ 2 weeks | 5–7 |
| **M3 Drafts** | `ai_drafts`; attendance draft from a photo or list; leave and cover drafts for admins; "Open in One to confirm" | D6 | 5–7 |
| **M4 Confirmed writes** | prepare/commit for attendance (own class), a teacher's own leave request (after its command id migration), marking a teacher away and cover (after splitting `arrangeDay`'s compute step) | M3 has run ≥ 2 weeks; D6 | 8–11 |
| **ChatGPT** | Same server; ChatGPT's redirect URIs and RFC 9207 issuer, `offline_access`, testing | Evidence from M0; D1 | 2–3 |

Total: about 7–9 developer-weeks to M4, of which the read-only admin pilot
(M0 + M1) is about 3–4.

### 8.1 The connection card in One

States come only from One's records, never guessed:

- **Not connected** — no connection row.
- **Allowed — last used 10:42 today** — row present; time from `ai_tool_calls`.
- **Allowed — not used for 30 days** — prompts *Disconnect* if unwanted.
- **Switched off by the school** — the kill switch is off.
- **Disconnected** — by the teacher or an admin, with the date.

One cannot know whether the connector is still installed in Claude or ChatGPT,
so the card says "allowed" and "last used", never "connected and working".

### 8.2 Running cost

- **One:** no new service. A few hundred rows a day; Vercel invocations in
  proportion to use. Supabase charges nothing extra for the OAuth server (S1);
  OAuth users are staff who already count toward MAU.
- **Model usage is paid by the teacher's AI plan, not by One.** Unlike One's
  own `assist` feature (`ANTHROPIC_API_KEY`, billed per token), MCP calls cost
  the school nothing in tokens.
- **Seats, if the school pays (D2):** Claude Team $20/seat/month annual
  ($25 monthly), from 2 seats (C19); ChatGPT Business $20/$25, from 2 seats
  (G11, reported). For 40 staff on Claude Team annual: $800/month. Prices in
  USD; Indian pricing and GST to be checked at purchase.
- **Free accounts:** no cost, one custom connector, the plan's usage limits,
  and consumer data terms (C18).

## 9. Decisions for the owner (Raj)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Which provider first | Claude only · ChatGPT only · both | **Claude only** for M0–M2; ChatGPT after M0 shows a Plus or Business workspace works |
| D2 | Whose AI accounts | Teachers' own Free/Pro (no cost; the school cannot set their training or retention) · school-paid Claude Team / ChatGPT Business seats (commercial terms, admin controls, ~$20/seat/month) · admins only | Admins only for the pilot; decide teachers before M2 |
| D3 | Pupil data ceiling | Level 0 aggregates · level 1 roll number + name for own class (§6.1) | Level 0 until D2 and D4 |
| D4 | Parental notice or consent | Ask the school's adviser whether sending pupils' names to an AI provider needs notice or consent under the Digital Personal Data Protection Act, 2023 | Ask before level 1 |
| D5 | Authorization server | One's own (B, §5.2) · Supabase's beta OAuth 2.1 server (A), which means switching it and DCR on in the production project and adding restrictive policies | B |
| D6 | Writes | Drafts only, committed in One · drafts, then prepare/commit for attendance → leave → cover | Drafts first; direct writes only after drafts have run cleanly |
| D7 | Who may connect | Named volunteers · class teachers · all teaching staff | Named admins, then volunteer teachers |
| D8 | Time limits | Tool log 180 days; re-consent every 90 days | As stated |
| D9 | Who controls it | Kill switch and *Disconnect someone else*: owner and admins | Owner and admins |
| D10 | Fee questions | Keep the existing Fees connector for owner and accountant; no fee tools in One's connection | As stated |
| D11 | Test accounts at the providers | Which Claude (Free, Pro, Team) and ChatGPT (Plus, Business) accounts the spike may use; any purchase is the owner's | Owner provides or approves |
| D12 | Photos of registers | Fine to photograph a register into Claude/ChatGPT (it shows every pupil's handwritten name) · not allowed | Tied to D3: allowed only at level 1 |
| D13 | A class teacher updating pupil details | Through the existing collection flow only: the office opens a request, the teacher answers, the office accepts · build a request a class teacher can start (new work in One, not AI work) | Existing flow; the AI only drafts answers |

## 10. Found on the way (not changed here)

- `/teach/student/[id]` shows a pupil's dues (`feeStanding`) to anyone with
  `collection:view` (`src/app/(app)/teach/student/[id]/page.tsx:128,138`).
  The rule that a teacher never gets `fees:*` (`permissions.ts:387-391`) does
  not cover it, because the name does not start with `fees:`. Harmless while
  no teacher role holds `collection:view`.
- `assist_log` has no purge job, so it is kept forever today.
- `requestLeaveVx` inserts with no idempotency key, so a retried request can
  file twice.

## 11. Not done here

No code, migration, environment variable, Supabase setting, provider account
or connector. The ChatGPT Help Center pages behind a human-verification check
were not read and must be read by a person before D1 is answered for ChatGPT.
`docs/PROGRESS.md` is not updated in this PR, which carries this document
only.
