-- ============================================================================
-- D-644 (16 Nov 2026): where One's old practice rows in the real year go.
--
-- Before the test-account fences (30 Oct) and the fee-writes switch (D-345),
-- QA accounts, smoke runs and a few owner rehearsals posted practice receipts,
-- made practice children and linked practice families in the REAL year
-- (2026-27) of One's copy of the fee tables. Fees never had them. One's
-- real-year data is now a copy of Fees (vppsone.fees_copy_run), so those rows
-- leave the real year: each one is kept here, whole, as jsonb, and then taken
-- out of its table (supabase/fee-migrations/20261116050500_practice_rows_out_of_real_year.sql).
--
-- Nothing reads this table. It is the record of what was moved and the way
-- back: `jsonb_populate_record(null::public.<table>, row_data)` gives the row
-- as it was.
--
-- Nothing here is reachable by anon, authenticated or service_role.
-- ============================================================================

create table if not exists vppsone.fees_copy_quarantine (
  id bigint generated always as identity primary key,
  table_schema text not null,
  table_name text not null,
  row_pk text not null,
  row_data jsonb not null,
  reason text not null,
  moved_at timestamptz not null default now(),
  unique (table_schema, table_name, row_pk)
);

alter table vppsone.fees_copy_quarantine enable row level security;
revoke all on table vppsone.fees_copy_quarantine from public, anon, authenticated, service_role;
