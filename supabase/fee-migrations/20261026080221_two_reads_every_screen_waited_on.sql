-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261026080221_two_reads_every_screen_waited_on.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- Two reads that staff waited on, made cheap. No money rule changes.
--
-- 1. Opening a student's profile counted `audit_logs` by `record_id` alone.
--
--    `getStudentDeletionSafety()` runs on every load of
--    `/protected/students/[studentId]` to decide whether the delete button is
--    offered, and one of its fifteen counts is
--    `audit_logs where record_id = $1`. The only index carrying `record_id` is
--    `idx_audit_logs_record (table_name, record_id, created_at desc)`, which
--    leads on `table_name`, so Postgres walked the whole index: 290 ms on
--    production (42k rows, 63 MB), with pg_stat_statements recording a 6.8 s
--    worst case. The profile streams, but it does not finish until that count
--    returns. With this index the same count is 0.7 ms.
--
--    Built in about six seconds on the current compute, inside the
--    transaction. `audit_logs` writes wait for it; reads do not.
--
-- 2. `get_student_segment_counts` materialised the directory twice over.
--
--    The 24 filter chips on the Students page come from this function. It
--    built a `population` CTE of `v_student_directory d.*` and referenced it
--    four times, so Postgres 17 materialised it -- every column of the view,
--    including the ones no chip reads -- and then scanned the copy once per
--    sub-select. 140 ms per call on production, warm, for 614 students; the
--    same view read directly is about 45 ms.
--
--    The rewrite is one scan with FILTER aggregates. `scoped` was `population`
--    narrowed by `p_statuses`, so it becomes a boolean, `in_scope`, and every
--    count that read `scoped` now reads `population ... filter (where
--    in_scope and ...)`. The enrolment block and populationTotal still count
--    the whole population, exactly as before.
--
--    Dry-run against production before shipping: the JSON returned by the old
--    and new bodies compared EQUAL for p_statuses null, ['active'],
--    ['left','graduated'], and for a text query across all classes. 140 ms ->
--    70 ms.
--
--    CREATE OR REPLACE keeps the existing grants (postgres, service_role,
--    authenticated).

begin;

create index if not exists idx_audit_logs_record_id
  on public.audit_logs using btree (record_id);

create or replace function public.get_student_segment_counts(
  p_session_label text,
  p_class_id uuid default null::uuid,
  p_route_id uuid default null::uuid,
  p_query text default null::text,
  p_statuses text[] default null::text[],
  p_active_classes_only boolean default true
)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'scopeTotal',      count(*) filter (where in_scope),
    'populationTotal', count(*),
    'enrolment', jsonb_build_object(
      'active',      count(*) filter (where seg_active),
      'left',        count(*) filter (where seg_left),
      'leftOwing',   count(*) filter (where seg_left_owing),
      'graduated',   count(*) filter (where seg_graduated),
      'newThisYear', count(*) filter (where seg_new_this_year)
    ),
    'counts', jsonb_build_object(
      'oldBalanceDue',       count(*) filter (where in_scope and seg_old_balance_due),
      'overdue',             count(*) filter (where in_scope and seg_overdue),
      'lateFeePending',      count(*) filter (where in_scope and seg_late_fee_pending),
      'partlyPaid',          count(*) filter (where in_scope and seg_partly_paid),
      'yearClear',           count(*) filter (where in_scope and seg_year_clear),
      'neverPaid',           count(*) filter (where in_scope and seg_never_paid),
      'hasDues',             count(*) filter (where in_scope and seg_has_dues),
      'missingPhone',        count(*) filter (where in_scope and seg_missing_phone),
      'duesNotPrepared',     count(*) filter (where in_scope and seg_dues_not_prepared),
      'missingDob',          count(*) filter (where in_scope and seg_missing_dob),
      'duplicateSr',         count(*) filter (where in_scope and seg_duplicate_sr),
      'pendingSr',           count(*) filter (where in_scope and seg_pending_sr),
      'onTransport',         count(*) filter (where in_scope and seg_on_transport),
      'hasDiscount',         count(*) filter (where in_scope and seg_has_discount),
      'discountRte',         count(*) filter (where in_scope and seg_discount_rte),
      'discountStaffChild',  count(*) filter (where in_scope and seg_discount_staff_child),
      'discountThirdChild',  count(*) filter (where in_scope and seg_discount_third_child),
      'feeException',        count(*) filter (where in_scope and seg_fee_exception),
      'lateFeeWaived',       count(*) filter (where in_scope and seg_late_fee_waived),
      'onEmi',               count(*) filter (where in_scope and seg_on_emi),
      'emiDue',              count(*) filter (where in_scope and seg_emi_due),
      'emiMissed',           count(*) filter (where in_scope and seg_emi_missed)
    )
  )
  from (
    select
      d.*,
      (p_statuses is null or d.record_status::text = any(p_statuses)) as in_scope
    from public.v_student_directory as d
    where d.session_label = p_session_label
      and (not p_active_classes_only or d.class_status = 'active')
      and (p_class_id is null or d.class_id = p_class_id)
      and (p_route_id is null or d.transport_route_id = p_route_id)
      and (
        p_query is null or btrim(p_query) = ''
        or d.search_text like '%' || lower(btrim(p_query)) || '%'
      )
  ) as population;
$function$;

commit;
