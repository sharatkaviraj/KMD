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
