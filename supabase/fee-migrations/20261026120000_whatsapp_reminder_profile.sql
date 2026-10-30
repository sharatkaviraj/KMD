-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261026120000_whatsapp_reminder_profile.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- How hard the school chases one family: on_time / standard / chronic /
-- hardship / quiet.
--
-- Cadence ("how often") was the only per-family judgement the reminder screen
-- could record. It could not say "this family pays on time, one polite note is
-- plenty" or "this family needs every step", so the office went on unticking
-- the same rows by hand. A profile is that judgement, stored once.
--
-- NULL is the normal state and is NOT "standard". It means "use the
-- suggestion", which the app works out from the ledger on every load (late fees
-- charged on passed installments, fees still owed on them, an active repayment
-- plan). A family who starts paying late moves on their own; a value here is the
-- office fixing a family in place.
--
-- WhatsApp only, like cadence. It never touches `no_call`, which is what the
-- Defaulters call queue reads.

alter table public.student_collection_flags
  add column if not exists whatsapp_profile text,
  add column if not exists whatsapp_profile_set_at timestamptz,
  add column if not exists whatsapp_profile_set_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_collection_flags_whatsapp_profile_check'
  ) then
    alter table public.student_collection_flags
      add constraint student_collection_flags_whatsapp_profile_check
      check (
        whatsapp_profile is null
        or whatsapp_profile in ('on_time', 'standard', 'chronic', 'hardship', 'quiet')
      );
  end if;
end $$;

comment on column public.student_collection_flags.whatsapp_profile is
  'How hard WhatsApp reminders chase this family: on_time, standard, chronic, hardship or '
  'quiet. NULL means "use the ledger''s suggestion", which the app recomputes on every load. '
  'An audience filter only — the reminder screen picks which profiles a run reaches. '
  'WhatsApp only; it does NOT affect the Defaulters call queue, which reads no_call.';

comment on column public.student_collection_flags.whatsapp_profile_set_at is
  'When the office last set whatsapp_profile by hand.';

comment on column public.student_collection_flags.whatsapp_profile_set_by is
  'auth.users id of whoever last set whatsapp_profile by hand.';

-- IMPORTANT, as on every column this table gains: `no_call` defaults to TRUE.
-- A row inserted only to record a profile must pass `no_call => false`
-- explicitly, or filing a family as "on time" would silently stop the fee
-- collectors calling them. The app updates first and inserts only when there is
-- no row, for exactly this reason.
