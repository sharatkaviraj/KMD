# One student loading and interaction performance

The user authorized implementation and immediate live release for One, specifically app loading, student lists/cards and Student 360. Target `one.vpps.co.in`, repository `veerpatta/vppsone`. Use the existing Next 16.4.3 / React 19 stack and current design.

## Evidence and approaches

The directory waits for task-field metadata before starting its main read, then waits for attendance before starting portraits. Student 360 starts portraits only after the full school model is ready. The signed-in shell awaits the informational bridge banner. Every search keystroke currently updates the 900-line directory component and rebuilds both desktop and mobile row trees; search additionally waits 450 ms.

Selected by the implementer under the user's implementation instruction: overlap independent authorized reads, stream the bridge banner, and isolate search state from the list. This removes identifiable waits without changing data freshness or the design. Add a 250 ms debounce, immediate Enter, composition support and cancellation on route/filter changes. Existing server data and local sorting remain authoritative.

Further code tracing found `termSummaries` fetching marks for every student on the class's papers, then using one student's map entries. Add an optional student filter to the current cookie/RLS marks reader, use it for individual summaries/report cards, and chunk paper IDs with the existing concurrency helper. Whole-class exports retain the unfiltered mode. This is an implementer scope addition: it directly reduces per-profile rows and preserves the existing authorization and numeric calculations.

`IntentLink` currently starts a full profile prefetch immediately on touch, including touches that become scrolls. Reuse its existing 90 ms intent delay for touch, cancel on movement/end/cancel, and clear timers on unmount. Keyboard focus remains immediate. This avoids background server work during card scrolling without changing destination navigation.

Alternatives considered: persistent financial/auth/photo caching can reduce requests but complicates fresh permissions and money; do not add it. A new joined directory RPC/index may help a measured slow query, but sampled database statistics do not establish that need; do not invent schema changes. Pagination and local Student 360 tabs already exist and are preserved.

## Boundaries

- Fresh identity, matrix permissions, session restrictions, visibility and class checks remain mandatory. No cross-request cache for permissions or finances; no shared cache for private photos.
- Start photos only after the existing visibility fence and use the current authorized reader. Contacts still start only after their existing access check.
- Task-field metadata can run beside the directory; a named missing-field filter waits for its validation before selecting students. Preserve all matching IDs and failure behavior.
- Bridge status is informational; its existing fresh health read and ready/stale/error labels stream inside Suspense. Data readers continue to enforce bridge readiness independently.
- Search inputs share draft state in a small provider. Row elements are passed as stable children, so typing does not reconstruct cards. Preserve URL filters, enrollment status, missing fields, layout and native GET fallback. Cancel obsolete timers on query/base URL changes and unmount. Enter and IME composition must work.
- Keep bilingual text, existing task/payment/message actions, financial calculations and source authority. No real messages, payments or student edits for testing.
- No migration is proposed unless further evidence demonstrates one is required. Do not replay pre-existing migration history.

## Verification and delivery

Write controlled-promise regressions that fail on serialized directory/portrait reads; prove identity and missing-field dependencies remain. Test shared search typing without rerendering a sibling, debounce, Enter, IME and obsolete navigation cancellation. Run the existing source/permission/student recovery tests, full typecheck, lint, port/theme guards, unit suite and production build/bundle budgets. Use synthetic narrow and desktop UI checks where the environment allows. Browser UI automation is disabled in Work settings; do not claim physical-phone or authenticated live browser testing.

Two existing non-smoke TEST roles returned the expected `students:view` denial during read-only probes. Those responses are excluded from timing results and sessions are revoked after each probe. Do not grant permissions for a benchmark. Review the final diff, merge only with required checks passing, stage production, verify the artifact, promote it, then verify One's actual aliases and runtime errors.
