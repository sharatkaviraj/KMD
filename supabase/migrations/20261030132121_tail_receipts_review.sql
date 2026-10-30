-- Fees receipts posted after the cutover watermark wait here for a person,
-- instead of arriving as raw rows (plan §7.8 option b, §12.1; critique0 #8).
--
-- A fees `payments` row carries an allocation (installment_id,
-- pending_before_posting, pending_after_posting) computed on the FEES ledger.
-- Copied into One after One has posted its own receipts, the same rows can
-- over-settle an installment, and per-student figures stop matching either
-- system. So scripts/migrate/tail-sync.mjs never inserts a fees receipt or
-- payment into public. It records the receipt header here, with its fees
-- receipt number and client_request_id and the allocation as evidence
-- (ids and amounts only), and a person posts it through One's own engine —
-- or marks it a duplicate of a One receipt, or rejects it.
--
-- Idempotent: one row per fees receipt id. Service role only.
--
-- Rollback:
--   drop table vppsone.tail_receipts_review;

create table vppsone.tail_receipts_review (
  id uuid primary key default gen_random_uuid(),
  source_project text not null check (source_project ~ '^[a-z]{20}$'),
  fees_receipt_id uuid not null,
  receipt_number text not null check (char_length(receipt_number) between 1 and 40),
  student_id uuid not null,
  payment_date date not null,
  payment_mode text not null check (char_length(payment_mode) between 1 and 40),
  total_amount integer not null check (total_amount > 0),
  client_request_id uuid,
  reference_number text check (reference_number is null or char_length(reference_number) <= 200),
  fees_created_at timestamptz,
  -- Allocation rows, order lines and capture ids from the fees ledger: ids and
  -- amounts only, never a name or phone (I-5).
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'posted', 'duplicate', 'rejected')),
  posted_receipt_id uuid,
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  run_id uuid references vppsone.migration_runs (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (source_project, fees_receipt_id),
  check ((status = 'pending') = (resolved_at is null)),
  check (status <> 'posted' or posted_receipt_id is not null)
);

comment on table vppsone.tail_receipts_review is
  'Fees receipts posted after the cutover watermark, waiting to be posted through One''s engine (critique0 #8). Never copied as raw payments.';

create index tail_receipts_review_pending on vppsone.tail_receipts_review (created_at) where status = 'pending';

alter table vppsone.tail_receipts_review enable row level security;
revoke all on vppsone.tail_receipts_review from public, anon, authenticated;
grant select, insert, update on vppsone.tail_receipts_review to service_role;
