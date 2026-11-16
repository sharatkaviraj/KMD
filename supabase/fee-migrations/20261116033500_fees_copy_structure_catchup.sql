-- ============================================================================
-- VPPS One fee-migration (One-only): catch One's fee tables up with the
-- columns and tables the fees app added between 31 Oct and 9 Nov 2026, so a
-- straight copy of the fees app's data fits (D-644, 16 Nov 2026).
--
-- Why this differs from the fees app: the fees app shipped these with its
-- household-communications work (households, split tenders, queued campaign
-- dispatch). That work also added ~140 functions, 175 triggers and fourteen
-- more household_* tables, which drive sending on the fees app's own number.
-- None of that is copied here. One needs only the SHAPE that holds the data,
-- so that the D-644 copy (vppsone.fees_copy_run) can bring every row across
-- unchanged:
--
--   * payment_mode 'split' (a receipt paid partly in cash, partly by UPI…),
--     and receipt_tenders, its lines;
--   * household_communication_preferences: the office's per-family contact
--     choices (cadence, no-contact, language, which numbers);
--   * whatsapp_run_households and the queued-dispatch columns on
--     whatsapp_campaign_runs;
--   * the household / quote columns on online_payment_intents/_orders,
--     whatsapp_reminder_sends and school_notice_sends, and the family-merge
--     columns on student_family_groups.
--
-- Left out on purpose:
--   * foreign keys to the fourteen household_* tables One does not have
--     (household_event_id, household_notice_claim_id,
--     household_recipient_claim_id stay plain uuid columns);
--   * the two deferred constraint triggers (receipt_tenders_balance,
--     receipts_split_has_tenders) and the fees app's audit / bridge triggers:
--     One posts no split receipt while fee writes are off, and copied rows
--     already passed them on the fees app;
--   * students_suggestion_*_idx: they index private.suggestion_phone(), which
--     belongs to the household suggestions feature One does not have.
--
-- Fees-app unique indexes that are LOOSER than One's older ones
-- (…_one_a_day_role, …_receipt_kind_role_idx, …_transactional_day_idx,
-- …_event_student_role) are created alongside One's here; retiring One's
-- older, stricter rules is a separate step.
--
-- Access: RLS on, as on the fees app. anon gets nothing; authenticated reads
-- receipt_tenders through the fees app's own policy and nothing else; writes
-- are for the owner and service_role only. receipt_tenders holds money, so it
-- carries the D-345 fee-writes guard like the other sixteen money tables.
--
-- Rollback: every object here is new or nullable/defaulted; nothing existing
-- changes meaning.
-- ============================================================================

alter type public.payment_mode add value if not exists 'split';

/* ------------------------------------------------- columns on old tables */

alter table public.online_payment_intents
  add column if not exists approved_student_ids uuid[],
  add column if not exists child_quote_snapshot jsonb,
  add column if not exists household_access_fingerprint text,
  add column if not exists household_key text;

alter table public.online_payment_orders
  add column if not exists approved_student_ids uuid[],
  add column if not exists child_quote_snapshot jsonb,
  add column if not exists household_access_fingerprint text,
  add column if not exists household_key text;

alter table public.school_notice_sends
  add column if not exists destination_role text not null default 'primary',
  add column if not exists household_key text,
  add column if not exists household_notice_claim_id uuid;

alter table public.school_notice_sends
  add constraint school_notice_sends_destination_role_check
  check (destination_role = any (array['primary', 'secondary']) or destination_role ~ '^contact:[0-9a-f]{64}$');

create unique index if not exists school_notice_sends_one_a_day_role
  on public.school_notice_sends (session_label, student_id, notice_kind, sent_on, destination_role);

alter table public.student_family_groups
  add column if not exists merged_into_family_group_id uuid,
  add column if not exists retired_at timestamptz;

alter table public.student_family_groups
  add constraint student_family_groups_merged_into_family_group_id_fkey
  foreign key (merged_into_family_group_id) references public.student_family_groups(id) on delete restrict;

alter table public.whatsapp_campaign_runs
  add column if not exists dispatch_job jsonb,
  add column if not exists dispatch_note text,
  add column if not exists dispatch_state text not null default 'finished',
  add column if not exists worker_heartbeat_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists worker_lease_until timestamptz,
  add column if not exists worker_starts integer not null default 0;

alter table public.whatsapp_campaign_runs
  add constraint whatsapp_campaign_runs_dispatch_state_check
  check (dispatch_state = any (array['queued', 'sending', 'finished', 'stopped']));

create index if not exists whatsapp_campaign_runs_open_dispatch_idx
  on public.whatsapp_campaign_runs (worker_lease_until)
  where dispatch_state = any (array['queued', 'sending']);

alter table public.whatsapp_reminder_sends
  add column if not exists child_quote_snapshot jsonb,
  add column if not exists household_access_fingerprint text,
  add column if not exists household_event_id uuid,
  add column if not exists household_key text,
  add column if not exists household_notice_claim_id uuid,
  add column if not exists household_recipient_claim_id uuid;

create unique index if not exists whatsapp_reminder_sends_event_student_role
  on public.whatsapp_reminder_sends (household_event_id, student_id, destination_role)
  where household_event_id is not null;

create unique index if not exists whatsapp_reminder_sends_receipt_kind_role_idx
  on public.whatsapp_reminder_sends (receipt_id, notice_kind, destination_role)
  where receipt_id is not null;

create unique index if not exists whatsapp_reminder_sends_transactional_day_idx
  on public.whatsapp_reminder_sends (student_id, session_label, sent_on, campaign_name, destination_role, notice_kind)
  where receipt_id is null and notice_kind <> 'reminder';

/* ------------------------------------------------------------ new tables */

create table if not exists public.household_communication_preferences (
  id uuid not null default gen_random_uuid(),
  household_key text not null,
  session_label text not null,
  no_contact boolean not null default false,
  cadence text not null default 'every_run',
  snoozed_until date,
  profile text,
  language text,
  primary_destination text,
  secondary_destination text,
  secondary_mode text not null default 'off',
  transactional_notices_enabled boolean not null default true,
  needs_review boolean not null default true,
  review_reasons text[] not null default array['settings_not_initialized'],
  version bigint not null default 1,
  member_student_ids uuid[] not null,
  migration_evidence jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_communication_preferences_pkey primary key (id),
  constraint household_communication_prefere_household_key_session_label_key unique (household_key, session_label),
  constraint household_communication_preferences_cadence_check
    check (cadence = any (array['every_run', 'weekly', 'fortnightly', 'monthly', 'never'])),
  constraint household_communication_preferences_check
    check (secondary_destination is null or primary_destination is distinct from secondary_destination),
  constraint household_communication_preferences_check1
    check (secondary_mode <> 'copy' or secondary_destination is not null),
  constraint household_communication_preferences_check2
    check (needs_review or cardinality(review_reasons) = 0),
  constraint household_communication_preferences_household_key_check
    check (household_key ~ '^(family|student):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint household_communication_preferences_language_check
    check (language = any (array['hi', 'en'])),
  constraint household_communication_preferences_member_student_ids_check
    check (cardinality(member_student_ids) > 0),
  constraint household_communication_preferences_primary_destination_check
    check (primary_destination ~ '^\+91[6-9][0-9]{9}$'),
  constraint household_communication_preferences_profile_check
    check (profile = any (array['on_time', 'standard', 'chronic', 'hardship', 'quiet'])),
  constraint household_communication_preferences_secondary_destination_check
    check (secondary_destination ~ '^\+91[6-9][0-9]{9}$'),
  constraint household_communication_preferences_secondary_mode_check
    check (secondary_mode = any (array['off', 'copy'])),
  constraint household_communication_preferences_session_label_check
    check (session_label ~ '^(TEST-|UAT-|DEMO-)?[0-9]{4}-[0-9]{2}$'),
  constraint household_communication_preferences_version_check
    check (version > 0),
  constraint household_communication_preferences_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint household_communication_preferences_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null
);

create table if not exists public.receipt_tenders (
  id uuid not null default gen_random_uuid(),
  receipt_id uuid not null,
  student_id uuid not null,
  line_no smallint not null,
  payment_mode public.payment_mode not null,
  amount integer not null,
  reference_number text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint receipt_tenders_pkey primary key (id),
  constraint receipt_tenders_amount_check check (amount > 0),
  constraint receipt_tenders_line_no_check check (line_no >= 1 and line_no <= 4),
  constraint receipt_tenders_mode_check
    check (payment_mode::text = any (array['cash', 'upi', 'bank_transfer', 'cheque'])),
  constraint receipt_tenders_line_unique unique (receipt_id, line_no),
  constraint receipt_tenders_mode_unique unique (receipt_id, payment_mode),
  constraint receipt_tenders_receipt_fk
    foreign key (receipt_id, student_id) references public.receipts(id, student_id) on delete restrict,
  constraint receipt_tenders_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null
);

create index if not exists idx_receipt_tenders_created_by on public.receipt_tenders (created_by);
create index if not exists idx_receipt_tenders_receipt_student on public.receipt_tenders (receipt_id, student_id);
create index if not exists idx_receipt_tenders_student on public.receipt_tenders (student_id);

create table if not exists public.whatsapp_run_households (
  run_id uuid not null,
  "position" integer not null,
  household_key text not null,
  item jsonb,
  state text not null default 'pending',
  attempts integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  outcome jsonb,
  finished_at timestamptz,
  constraint whatsapp_run_households_pkey primary key (run_id, "position"),
  constraint whatsapp_run_households_run_id_household_key_key unique (run_id, household_key),
  constraint whatsapp_run_households_position_check check ("position" >= 0),
  constraint whatsapp_run_households_state_check
    check (state = any (array['pending', 'sending', 'done', 'stopped'])),
  constraint whatsapp_run_households_run_id_fkey
    foreign key (run_id) references public.whatsapp_campaign_runs(id) on delete cascade
);

/* ---------------------------------------------------------------- access */

alter table public.household_communication_preferences enable row level security;
alter table public.receipt_tenders enable row level security;
alter table public.whatsapp_run_households enable row level security;

revoke all on table public.household_communication_preferences from anon, authenticated;
revoke all on table public.receipt_tenders from anon, authenticated;
revoke all on table public.whatsapp_run_households from anon, authenticated;

grant select on table public.receipt_tenders to authenticated;
grant all on table public.household_communication_preferences to service_role;
grant all on table public.receipt_tenders to service_role;
grant all on table public.whatsapp_run_households to service_role;

create policy "authenticated can read receipt tenders"
  on public.receipt_tenders
  for select
  to authenticated
  using ((select public.has_any_permission(array['payments:view', 'ledger:view', 'receipts:view', 'dashboard:view', 'finance:view'])));

-- The D-345 switch and the test-account fence, as on the other money tables
-- (20261030230200 / 20261031000200).
create trigger fee_writes_row_guard
  before insert or update or delete on public.receipt_tenders
  for each row execute function vppsone.fee_money_row_guard();

create trigger fee_writes_truncate_guard
  before truncate on public.receipt_tenders
  for each statement execute function vppsone.fee_money_truncate_guard();
