-- ============================================================================
-- D-645 (16 Nov 2026): the copy's night.
--
-- One's real-year fee data is a copy of Fees (D-644, vppsone.fees_copy_run),
-- taken once a night (D-457). With the Fees link off, three things the link
-- used to take care of have to follow each copy, and they do here, in the same
-- transaction as the copy itself (vppsone.fees_copy_nightly):
--
--   1. One's class lists follow the copied children
--      (vppsone.fees_copy_sync_enrolments). Fees is the truth for children and
--      classes (owner, 14 Nov). With the link on, a register refused to open
--      when its class list disagreed with Fees and the office rebuilt it by
--      hand (assert_fees_bridge_roster_current); with the link off nothing
--      would notice. So, in the active session only:
--        * a child Fees has on the roll in one of its classes and One has not
--          enrolled is enrolled, with Fees' roll number;
--        * a child Fees has moved to another class moves, with Fees' roll
--          number (an old roll number means nothing in a new class);
--        * a child Fees has back on the roll, in the class One has, is
--          enrolled again;
--        * a child Fees marks left or inactive is marked left, on Fees' leave
--          date (or today): history stays, the register stops showing them.
--      'promoted' rows, roll numbers One edited for a child who did not move,
--      and children only One has are left as they are. Never a TEST session;
--      the active session is app_settings.active_session_label, which the copy
--      brings from Fees. Insert and update only.
--   2. The money views are refreshed there and then
--      (refresh_workbook_materialized_views_if_requested), rather than up to
--      two minutes later by the refresh job, so that
--   3. the request that clears One's saved screens (/api/jobs/fees-copy-done,
--      through pg_net, which sends it after commit) finds them current. Fee
--      reads cached under session:<label> or student:<id> have no expiry of
--      their own; without the request a screen keeps showing yesterday.
--
-- The request's Bearer secret is FEES_COPY_CRON_SECRET in Vault, checked in
-- Postgres (vppsone.fees_copy_secret_matches), so no copy of it sits in Vercel.
--
-- Each of the three is its own sub-transaction: a failure is written into the
-- run's report (fees_copy_runs.report->'after') and never undoes the copy.
--
-- The schedule is not here. The night's jobs are added once the first apply
-- has been checked against Fees, in a migration of their own.
--
-- Also: fees_copy_run's comment named the file by the version it had before
-- the database stamped it (20261116041000); it is corrected here.
--
-- Rollback: remove the three functions and the Vault secret. Nothing else
-- depends on them.
-- ============================================================================

create or replace function vppsone.fees_copy_sync_enrolments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session text;
  n_enrolled bigint := 0;
  n_moved bigint := 0;
  n_back bigint := 0;
  n_left bigint := 0;
begin
  select nullif(btrim(s.value), '') into v_session
    from public.app_settings s
   where s.key = 'active_session_label';
  if v_session is null or v_session !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('session', v_session, 'skipped', 'no real active session');
  end if;

  -- On the roll in Fees, in a class of the active session, not enrolled here.
  insert into vppsone.enrolments (student_id, class_id, session_label, roll_no, status)
  select st.id, st.class_id, v_session, st.roll_no, 'enrolled'
    from public.students st
    join public.classes c on c.id = st.class_id
   where c.session_label = v_session
     and lower(coalesce(st.status::text, '')) not in ('left', 'inactive', 'graduated')
     and not exists (select 1 from vppsone.enrolments e
                      where e.student_id = st.id and e.session_label = v_session)
  on conflict (student_id, session_label) do nothing;
  get diagnostics n_enrolled = row_count;

  -- Moved to another class of the same session.
  update vppsone.enrolments e
     set class_id = st.class_id, roll_no = st.roll_no, status = 'enrolled', left_on = null
    from public.students st
    join public.classes c on c.id = st.class_id
   where e.student_id = st.id
     and e.session_label = v_session
     and c.session_label = v_session
     and lower(coalesce(st.status::text, '')) not in ('left', 'inactive', 'graduated')
     and e.status <> 'promoted'
     and e.class_id <> st.class_id;
  get diagnostics n_moved = row_count;

  -- Back on the roll, in the class One has.
  update vppsone.enrolments e
     set status = 'enrolled', left_on = null
    from public.students st
    join public.classes c on c.id = st.class_id
   where e.student_id = st.id
     and e.session_label = v_session
     and c.session_label = v_session
     and lower(coalesce(st.status::text, '')) not in ('left', 'inactive', 'graduated')
     and e.status = 'left'
     and e.class_id = st.class_id;
  get diagnostics n_back = row_count;

  -- Left, or inactive, in Fees.
  update vppsone.enrolments e
     set status = 'left', left_on = coalesce(st.left_on, (pg_catalog.now() at time zone 'Asia/Kolkata')::date)
    from public.students st
   where e.student_id = st.id
     and e.session_label = v_session
     and e.status = 'enrolled'
     and lower(coalesce(st.status::text, '')) in ('left', 'inactive');
  get diagnostics n_left = row_count;

  return jsonb_build_object('session', v_session, 'enrolled', n_enrolled, 'moved', n_moved,
                            'back', n_back, 'left', n_left);
end
$fn$;

revoke all on function vppsone.fees_copy_sync_enrolments() from public, anon, authenticated, service_role;

comment on function vppsone.fees_copy_sync_enrolments() is
  'D-645: One''s class lists follow the copied children of the active session (enrol, move, back, left). See 20261116060000_fees_copy_nightly.sql.';

-- The secret the night's request carries. Never leaves the database.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'FEES_COPY_CRON_SECRET',
  'D-645: pg_cron -> /api/jobs/fees-copy-done after the nightly copy. Checked by vppsone.fees_copy_secret_matches; never copied to Vercel.')
where not exists (select 1 from vault.secrets s where s.name = 'FEES_COPY_CRON_SECRET');

create or replace function vppsone.fees_copy_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.decrypted_secret = p_secret and length(p_secret) = 64
       from vault.decrypted_secrets s where s.name = 'FEES_COPY_CRON_SECRET'),
    false)
$$;

revoke all on function vppsone.fees_copy_secret_matches(text) from public, anon, authenticated;
grant execute on function vppsone.fees_copy_secret_matches(text) to service_role;

create or replace function vppsone.fees_copy_nightly()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_report jsonb;
  v_run bigint;
  v_after jsonb := '{}'::jsonb;
begin
  v_report := vppsone.fees_copy_run('apply');
  v_run := nullif(v_report->>'run', '')::bigint;
  if v_report->>'status' is distinct from 'applied' then
    return v_report;
  end if;

  begin
    v_after := v_after || jsonb_build_object('enrolments', vppsone.fees_copy_sync_enrolments());
  exception when others then
    v_after := v_after || jsonb_build_object('enrolments', jsonb_build_object('error', sqlerrm));
  end;

  begin
    v_after := v_after || jsonb_build_object('money_views_refreshed', public.refresh_workbook_materialized_views_if_requested());
  exception when others then
    v_after := v_after || jsonb_build_object('money_views_refreshed', false, 'money_views_error', sqlerrm);
  end;

  begin
    perform net.http_post(
      url := 'https://one.vpps.co.in/api/jobs/fees-copy-done',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s
                                        where s.name = 'FEES_COPY_CRON_SECRET')),
      body := jsonb_build_object('run', v_run),
      timeout_milliseconds := 55000);
    v_after := v_after || jsonb_build_object('screens_cleared', 'asked');
  exception when others then
    v_after := v_after || jsonb_build_object('screens_cleared', 'not asked: ' || sqlerrm);
  end;

  update vppsone.fees_copy_runs
     set report = coalesce(report, '{}'::jsonb) || jsonb_build_object('after', v_after)
   where id = v_run;
  return v_report || jsonb_build_object('after', v_after);
end
$fn$;

revoke all on function vppsone.fees_copy_nightly() from public, anon, authenticated, service_role;

comment on function vppsone.fees_copy_nightly() is
  'D-645: the night''s copy, then class lists, money views and the request that clears One''s saved screens. See 20261116060000_fees_copy_nightly.sql.';

comment on function vppsone.fees_copy_run(text) is
  'D-644: copy the Fees app''s data into One (plan | rehearse | apply). See the header of 20261116042616_fees_copy_run.sql.';
