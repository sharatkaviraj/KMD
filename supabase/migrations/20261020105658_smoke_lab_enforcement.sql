-- Smoke Lab, second pass after an independent security review (20 Oct 2026).
-- DEV ONLY, like 20261020103153_smoke_lab.sql (a D-skip for the live cutover).
--
-- 1. Runs are enforced by the database, not only the app. A smoke account
--    with no live pass is banned and its sessions deleted, so the tokens an
--    agent holds stop refreshing even if it never touches the app again;
--    one with a live pass is unbanned. `smoke_enforce()` runs on every
--    open/close/revoke (the app calls it) and every two minutes (pg_cron),
--    which is how expiry is enforced.
-- 2. `smoke_access_allowed()` answers only for the pool: anybody outside it
--    gets false (the app asks it only about smoke accounts).
-- 3. Counters and repeats are single statements (no read-then-write).
-- 4. Per-run finding counts are aggregated here, not read row by row.
-- 5. The pool remembers a borrowed teacher profile's language, so release
--    can put it back.
--
-- Rollback: select cron.unschedule('smoke-enforce'); drop the five functions
-- added here; restore smoke_access_allowed from 20261020103153; update
-- auth.users set banned_until = null where id in (select auth_user_id from
-- vppsone.smoke_pool); alter table vppsone.smoke_pool drop column original_language.

alter table vppsone.smoke_pool add column original_language text;

create or replace function vppsone.smoke_access_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from vppsone.smoke_passes s
    join vppsone.smoke_runs r on r.id = s.run_id
    join vppsone.smoke_pool p on p.email = s.pool_email
    where p.auth_user_id = auth.uid()
      and s.revoked_at is null
      and s.expires_at > now()
      and r.status = 'open'
      and r.expires_at > now()
  );
$$;

create function vppsone.smoke_enforce() returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer := 0; n integer;
begin
  with live as (
    select distinct p.auth_user_id
    from vppsone.smoke_pool p
    join vppsone.smoke_passes s on s.pool_email = p.email
    join vppsone.smoke_runs r on r.id = s.run_id
    where s.revoked_at is null and s.expires_at > now() and r.status = 'open' and r.expires_at > now()
  )
  update auth.users u
     set banned_until = case when u.id in (select auth_user_id from live) then null else 'infinity'::timestamptz end
   where u.id in (select auth_user_id from vppsone.smoke_pool)
     and u.banned_until is distinct from (case when u.id in (select auth_user_id from live) then null else 'infinity'::timestamptz end);
  get diagnostics n = row_count;
  changed := changed + n;

  delete from auth.sessions s
   where s.user_id in (select auth_user_id from vppsone.smoke_pool)
     and s.user_id in (select id from auth.users where banned_until is not null and banned_until > now());
  get diagnostics n = row_count;
  return changed + n;
end; $$;

create function vppsone.smoke_touch_pass(p_pass uuid) returns void
language sql security definer set search_path = '' as $$
  update vppsone.smoke_passes
     set uses = uses + 1, last_used_at = now(), first_used_at = coalesce(first_used_at, now())
   where id = p_pass;
$$;

create function vppsone.smoke_record_finding(
  p_run uuid, p_pass uuid, p_role vppsone.staff_role, p_reporter text, p_kind text, p_severity text,
  p_title text, p_screen text, p_steps text, p_expected text, p_actual text, p_evidence text, p_fingerprint text
) returns table (id uuid, repeat boolean)
language sql security definer set search_path = '' as $$
  insert into vppsone.smoke_findings (run_id, pass_id, role, reporter, kind, severity, title, screen, steps, expected, actual, evidence, fingerprint)
  values (p_run, p_pass, p_role, p_reporter, p_kind, p_severity, p_title, p_screen, p_steps, p_expected, p_actual, p_evidence, p_fingerprint)
  on conflict (run_id, fingerprint) do update set repeats = vppsone.smoke_findings.repeats + 1
  returning vppsone.smoke_findings.id, (xmax <> 0) as repeat;
$$;

create function vppsone.smoke_run_counts(p_runs uuid[]) returns table (run_id uuid, total integer, open integer, p1 integer)
language sql stable security definer set search_path = '' as $$
  select f.run_id,
         count(*)::integer,
         count(*) filter (where f.status in ('new', 'confirmed', 'regressed'))::integer,
         count(*) filter (where f.status in ('new', 'confirmed', 'regressed') and f.severity = 'P1')::integer
    from vppsone.smoke_findings f
   where f.run_id = any (p_runs)
   group by f.run_id;
$$;

revoke all on function vppsone.smoke_enforce() from public, anon, authenticated;
revoke all on function vppsone.smoke_touch_pass(uuid) from public, anon, authenticated;
revoke all on function vppsone.smoke_record_finding(uuid, uuid, vppsone.staff_role, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function vppsone.smoke_run_counts(uuid[]) from public, anon, authenticated;
grant execute on function vppsone.smoke_enforce() to service_role;
grant execute on function vppsone.smoke_touch_pass(uuid) to service_role;
grant execute on function vppsone.smoke_record_finding(uuid, uuid, vppsone.staff_role, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function vppsone.smoke_run_counts(uuid[]) to service_role;

select cron.schedule('smoke-enforce', '*/2 * * * *', $cron$select vppsone.smoke_enforce()$cron$);

-- Every pool account is banned until a run gives it a pass.
select vppsone.smoke_enforce();
