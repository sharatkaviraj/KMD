-- ============================================================================
-- D-648 (16 Nov 2026): what One's saved screens are cleared of after the
-- night's copy.
--
-- vppsone.fees_copy_nightly (20261116050933_fees_copy_nightly.sql) ends by
-- asking /api/jobs/fees-copy-done to clear One's saved screens. With the Fees
-- link off, One keeps fee reads under these tags, and the ones below have no
-- expiry of their own, so without that request a screen shows yesterday:
--
--   session:<label>     the dashboard, the desk, defaulters (every real year)
--   dues-badge:<label>  the dues number in the menu
--   student:<id>        a child's fee picture (every child of a real year)
--
-- vppsone.fees_copy_cache_tags() names them from the copied rows themselves,
-- so a year or a child the copy brings tonight is cleared tonight. The route
-- adds the few fixed tags (fee-policy, setup-readiness, app-settings,
-- vx-classes). A TEST year is never named: the copy never touches it, and
-- One's own writes clear it as they always have.
--
-- Also: the nightly migration's header and its two comments call the decision
-- D-645. D-645 went to another change the same morning; this one is D-648,
-- and the comments are corrected here, with the file's stamped version.
--
-- Rollback: remove the function. Nothing in the database calls it.
-- ============================================================================

create or replace function vppsone.fees_copy_cache_tags()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with labels as (
    select distinct c.session_label as label from public.classes c
    union
    select nullif(pg_catalog.btrim(s.value), '') from public.app_settings s where s.key = 'active_session_label'
  ), real_labels as (
    select l.label from labels l where l.label ~ '^\d{4}-\d{2}$'
  )
  select coalesce(pg_catalog.array_agg(t.tag order by t.tag), '{}'::text[])
    from (
      select 'session:' || r.label as tag from real_labels r
      union
      select 'dues-badge:' || r.label from real_labels r
      union
      select 'student:' || st.id::text
        from public.students st
        left join public.classes c on c.id = st.class_id
       where c.id is null or c.session_label in (select r.label from real_labels r)
    ) t
$$;

revoke all on function vppsone.fees_copy_cache_tags() from public, anon, authenticated;
grant execute on function vppsone.fees_copy_cache_tags() to service_role;

comment on function vppsone.fees_copy_cache_tags() is
  'D-648: the cache tags /api/jobs/fees-copy-done expires after the night''s copy (every real year and its children). See 20261116060000_fees_copy_cache_tags.sql.';

comment on function vppsone.fees_copy_nightly() is
  'D-648: the night''s copy, then class lists, money views and the request that clears One''s saved screens. See 20261116050933_fees_copy_nightly.sql.';

comment on function vppsone.fees_copy_sync_enrolments() is
  'D-648: One''s class lists follow the copied children of the active session (enrol, move, back, left). See 20261116050933_fees_copy_nightly.sql.';

comment on function vppsone.fees_copy_secret_matches(text) is
  'D-648: is this the Bearer secret the night''s request carries (Vault FEES_COPY_CRON_SECRET)? See 20261116050933_fees_copy_nightly.sql.';
