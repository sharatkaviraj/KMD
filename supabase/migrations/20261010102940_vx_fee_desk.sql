-- VPPS One — fee desk redesign (receipts & day close, dues & calls, fee
-- reminders). Additive, vppsone only; nothing here touches `public`, and no
-- fee money is written here: receipts, payments and reversals stay in the fee
-- RPCs. Applied as six small migrations (the connector timed out on one large
-- one); this first one creates fee_call_promises, completed in
-- 20261010102952_vx_fee_call_promises_rules.sql.

create table if not exists vppsone.fee_call_promises (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  student_id uuid not null,
  kind text not null default 'pay',
  promised_on date not null,
  amount numeric(12, 2) not null default 0,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
