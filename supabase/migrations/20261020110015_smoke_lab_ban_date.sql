-- Smoke Lab: ban with a far-future date, not 'infinity' (DEV ONLY, D-skip).
--
-- 20261020105658 banned pool accounts with banned_until = 'infinity'. Postgres
-- accepts it; Supabase Auth cannot scan it into a Go time, so loading any of
-- those users failed ("Database error loading user") and so did listing the
-- project's users at all — every admin user screen and script on the test
-- database. Auth's own "ban forever" is a duration of about a hundred years,
-- so this uses a fixed date that far out, which also keeps the comparison in
-- smoke_enforce() stable (no rewrite every two minutes).
--
-- Rollback: re-apply smoke_enforce() from 20261020105658 (not advised).

create or replace function vppsone.smoke_enforce() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  changed integer := 0;
  n integer;
  banned constant timestamptz := '2999-12-31 00:00:00+00';
begin
  with live as (
    select distinct p.auth_user_id
    from vppsone.smoke_pool p
    join vppsone.smoke_passes s on s.pool_email = p.email
    join vppsone.smoke_runs r on r.id = s.run_id
    where s.revoked_at is null and s.expires_at > now() and r.status = 'open' and r.expires_at > now()
  )
  update auth.users u
     set banned_until = case when u.id in (select auth_user_id from live) then null else banned end
   where u.id in (select auth_user_id from vppsone.smoke_pool)
     and u.banned_until is distinct from (case when u.id in (select auth_user_id from live) then null else banned end);
  get diagnostics n = row_count;
  changed := changed + n;

  delete from auth.sessions s
   where s.user_id in (select auth_user_id from vppsone.smoke_pool)
     and s.user_id in (select id from auth.users where banned_until is not null and banned_until > now());
  get diagnostics n = row_count;
  return changed + n;
end; $$;

revoke all on function vppsone.smoke_enforce() from public, anon, authenticated;
grant execute on function vppsone.smoke_enforce() to service_role;

select vppsone.smoke_enforce();
