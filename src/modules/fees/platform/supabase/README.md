# `modules/fees/platform/supabase` — the fee-scoped clients

Four files that are `src/platform/supabase/*` with one value changed: the
default schema is `public` rather than `vppsone`.

**This is not a style choice.** Ported fee code calls `.from("students")` with
no `.schema()`, because in its own repo `public` was the default. Left on VPPS
One's clients, every one of those ~600 files' queries would silently address
`vppsone.students`, which does not exist — or worse, address a `vppsone` table
that happens to share a name. The codemod in `scripts/port-rewrite-imports.mjs`
points every ported import here, and nothing else should.

The service-role client is the one that matters. Fee RLS policies are written
against `public.users.role`, and 24 of this app's 28 staff profiles have no
`public.users` row at all — so RLS would refuse almost every fee write. Rather
than create those rows (a write to `public`, and a second place a person's role
is recorded that can disagree with the first), fee writes bypass RLS and
**VPPS One's permission map is the security boundary**.

That trade is only safe because it is enforced rather than remembered.
`tests/architecture.test.ts` asserts that every file touching this client also
checks a permission in the same file.

## The fee writes switch (D-345, D-346)

Both server clients send every request through `write-guard.ts`. It is the
one place the app decides whether a fee write may happen *now*: while writes
are test-only — any Preview or local deployment (`isConfinedDeployment()`),
`app_settings.fee_writes_enabled = 'false'`, or a production database before
the key is `'true'` — an insert, update, upsert, delete or write RPC goes
through only if every student, receipt, plan, waiver, refund, class or
session it names resolves to a TEST session. Anything else is answered with
the database's own `VPP01` refusal, without reaching PostgREST. The money
functions check the same rule themselves
(`supabase/fee-migrations/20261030230000_fee_writes_guard.sql`), so a direct
RPC call is refused too.
