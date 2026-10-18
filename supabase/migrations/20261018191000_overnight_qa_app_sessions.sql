-- REDUCED APP-ONLY REVIEW ARTIFACT. Apply only to wtgxcptmucjerhufzjcf after review.
-- Never apply to the protected/live project. Run target guard before applying.
-- No Auth writes, no token storage, no public data writes or public policy changes.
-- Existing six QA accounts only. No Storage/public policy changes or new Auth users.
-- Expiry/revocation is enforced ONLY by VPPS One application guards.
-- NO existing policies or helper functions change. Direct Supabase/Storage access remains inherited.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Identity preflight: refuse an unexpected database or changed owner binding.
do $$ begin
  if not exists(select 1 from vppsone.staff_profiles sp join auth.users u on u.id=sp.user_id
    where sp.id='30c6b4d7-df2d-4ae2-873f-221e3d2ee55d' and sp.user_id='94751583-3fbd-422b-b748-9104e85c1644'
      and sp.role='admin' and sp.is_active and lower(u.email)='raj@vpps.co.in') then
    raise exception 'DAYRUN: owner/project identity preflight failed';
  end if;
end $$;

create table vppsone.qa_dayrun_runs (
  id text primary key check(id='overnight-20261019'),
  project_ref text not null check(project_ref='wtgxcptmucjerhufzjcf'),
  owner_user_id uuid not null check(owner_user_id='94751583-3fbd-422b-b748-9104e85c1644'),
  owner_staff_profile_id uuid not null check(owner_staff_profile_id='30c6b4d7-df2d-4ae2-873f-221e3d2ee55d'),
  expires_at timestamptz not null check(expires_at='2026-10-19T07:00:00Z'::timestamptz),
  enabled boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create table vppsone.qa_dayrun_accounts (
  run_id text not null references vppsone.qa_dayrun_runs(id) on delete restrict,
  alias text primary key check(alias in('admin','accountant','academic','exam','teacher','teacher2')),
  user_id uuid unique, -- deliberately no auth.users FK: tombstones survive user deletion
  staff_profile_id uuid not null unique,
  email text not null unique,
  role vppsone.staff_role not null,
  is_new boolean not null,
  revoked_at timestamptz,
  registered_at timestamptz,
  check(not is_new)
);
create table vppsone.qa_dayrun_pairs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references vppsone.qa_dayrun_runs(id) on delete restrict,
  target_origin text not null check(target_origin='https://vppsone-veerpattas-projects.vercel.app'),
  secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
  request_key_hash text not null check(request_key_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check(status in('pending','authorized','consuming','used','failed','revoked')),
  alias text references vppsone.qa_dayrun_accounts(alias) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  approved_by uuid,
  consuming_at timestamptz,
  used_at timestamptz,
  failed_at timestamptz,
  check(expires_at<=created_at+interval '5 minutes'),
  check(expires_at<='2026-10-19T07:00:00Z'::timestamptz)
);
create index qa_dayrun_pairs_rate on vppsone.qa_dayrun_pairs(created_at,request_key_hash);
create table vppsone.qa_dayrun_sessions (
  session_id uuid primary key, -- deliberately no auth.sessions FK; never delete a lease
  run_id text not null references vppsone.qa_dayrun_runs(id) on delete restrict,
  pair_id uuid not null unique references vppsone.qa_dayrun_pairs(id) on delete restrict,
  alias text not null references vppsone.qa_dayrun_accounts(alias) on delete restrict,
  user_id uuid not null,
  staff_profile_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null check(expires_at='2026-10-19T07:00:00Z'::timestamptz),
  revoked_at timestamptz
);
create index qa_dayrun_sessions_user on vppsone.qa_dayrun_sessions(user_id);
insert into vppsone.qa_dayrun_runs(id,project_ref,owner_user_id,owner_staff_profile_id,expires_at)
values('overnight-20261019','wtgxcptmucjerhufzjcf','94751583-3fbd-422b-b748-9104e85c1644','30c6b4d7-df2d-4ae2-873f-221e3d2ee55d','2026-10-19T07:00:00Z');

insert into vppsone.qa_dayrun_accounts(run_id,alias,user_id,staff_profile_id,email,role,is_new,registered_at) values
('overnight-20261019','admin','3f64f814-5d57-4b1c-a860-725eb65efda7','1520b49a-5e25-4a53-8f3d-210a4d35fbeb','qa.admin@qa.vpps.local','admin',false,clock_timestamp()),
('overnight-20261019','accountant','f8d35f69-debd-4273-8c03-13efca8a20d2','c96ffb1a-e9ef-4ced-abb5-54587bbb4908','qa.fees@qa.vpps.local','accountant',false,clock_timestamp()),
('overnight-20261019','academic','8973f5dd-5f3b-4c15-9534-e804cab8db31','0f2ecc32-6c5a-4f90-b741-8dad29b77c4b','qa.academic@qa.vpps.local','academic_coordinator',false,clock_timestamp()),
('overnight-20261019','exam','1b07ce9c-8f87-4d65-953a-91e2fddb4244','119ee211-fd46-421e-a6b2-9ea2aab4e5f7','qa.exam@qa.vpps.local','exam_coordinator',false,clock_timestamp()),
('overnight-20261019','teacher','392a7a49-5ec3-44db-a605-9f8dc057a292','29d76340-1929-4848-ad4f-8a3ae5653a43','qa.teacher@qa.vpps.local','teacher',false,clock_timestamp()),
('overnight-20261019','teacher2','cb4848e1-155c-44dd-b0b2-9d7b9815972e','b9805a93-f3ee-4e53-a0df-e053b5fcb795','qa.teacher2@qa.vpps.local','teacher',false,clock_timestamp());


-- Freeze identity pins and permanent revocation/session tombstones.
create function vppsone.qa_dayrun_preserve_tombstone() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op in('DELETE','TRUNCATE') then raise exception 'DAYRUN: tombstones must never be deleted'; end if;
  if tg_table_name='qa_dayrun_runs' then
    if (to_jsonb(new)-'enabled'-'revoked_at') is distinct from (to_jsonb(old)-'enabled'-'revoked_at')
       or(old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
      raise exception 'DAYRUN: immutable run'; end if;
  elsif tg_table_name='qa_dayrun_accounts' then
    if (to_jsonb(new)-'user_id'-'registered_at'-'revoked_at') is distinct from (to_jsonb(old)-'user_id'-'registered_at'-'revoked_at')
       or(old.user_id is not null and new.user_id is distinct from old.user_id)
       or(old.registered_at is not null and new.registered_at is distinct from old.registered_at)
       or(old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
      raise exception 'DAYRUN: immutable identity pin'; end if;
  elsif tg_table_name='qa_dayrun_pairs' then
    if new.id is distinct from old.id or new.run_id is distinct from old.run_id
       or new.target_origin is distinct from old.target_origin or new.secret_hash is distinct from old.secret_hash
       or new.request_key_hash is distinct from old.request_key_hash or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at
       or(old.alias is not null and new.alias is distinct from old.alias) then
      raise exception 'DAYRUN: immutable pair binding'; end if;
  elsif tg_table_name='qa_dayrun_sessions' then
    if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
       or(old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
      raise exception 'DAYRUN: immutable session lease'; end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['qa_dayrun_runs','qa_dayrun_accounts','qa_dayrun_pairs','qa_dayrun_sessions'] loop
    execute format('alter table vppsone.%I enable row level security',t);
    execute format('revoke all on vppsone.%I from public, anon, authenticated, service_role',t);
    execute format('grant select on vppsone.%I to service_role',t);
    execute format('create trigger preserve_dayrun_tombstone before delete or update on vppsone.%I for each row execute function vppsone.qa_dayrun_preserve_tombstone()',t);
    execute format('create trigger preserve_dayrun_truncate before truncate on vppsone.%I for each statement execute function vppsone.qa_dayrun_preserve_tombstone()',t);
  end loop;
end $$;

create function vppsone.qa_dayrun_access_allowed() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare
  u uuid := auth.uid();
  sid uuid;
  s vppsone.qa_dayrun_sessions%rowtype;
  r vppsone.qa_dayrun_runs%rowtype;
begin
  -- Restriction is ONLY for a launcher-issued session_id. Existing unrelated
  -- sessions and all other users retain their original access decisions.
  begin sid := (auth.jwt()->>'session_id')::uuid;
    exception when invalid_text_representation then return true; end;
  select * into s from vppsone.qa_dayrun_sessions where session_id=sid;
  if not found then return true; end if;
  select * into r from vppsone.qa_dayrun_runs where id=s.run_id;
  return found and s.user_id=u and s.revoked_at is null and r.enabled and r.revoked_at is null
    and clock_timestamp()<s.expires_at and clock_timestamp()<r.expires_at
    and exists(select 1 from vppsone.qa_dayrun_accounts a join vppsone.staff_profiles p on p.id=a.staff_profile_id
      where a.alias=s.alias and a.user_id=u and a.staff_profile_id=s.staff_profile_id and a.revoked_at is null
        and p.user_id=u and p.role=a.role and p.is_active);
end $$;
create function vppsone.qa_dayrun_create_pair(p_secret_hash text,p_request_key_hash text,p_target_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r vppsone.qa_dayrun_runs%rowtype; v_id uuid; v_now timestamptz:=clock_timestamp(); v_exp timestamptz;
begin
  if p_target_origin is distinct from 'https://vppsone-veerpattas-projects.vercel.app' then return null; end if;
  if p_secret_hash is null or p_request_key_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' or p_request_key_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  -- Serializes all create/approve/consume/complete/revoke races and cap checks.
  select * into r from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  if not r.enabled or r.revoked_at is not null or v_now>=r.expires_at then return null; end if;
  if (select count(*) from vppsone.qa_dayrun_pairs)>=300
    or(select count(*) from vppsone.qa_dayrun_pairs where created_at>v_now-interval '1 minute')>=30
    or(select count(*) from vppsone.qa_dayrun_pairs where request_key_hash=p_request_key_hash and created_at>v_now-interval '1 minute')>=5
    or(select count(*) from vppsone.qa_dayrun_pairs where status in('pending','authorized','consuming') and expires_at>v_now)>=25 then return null; end if;
  v_exp:=least(v_now+interval '5 minutes',r.expires_at);
  insert into vppsone.qa_dayrun_pairs(run_id,target_origin,secret_hash,request_key_hash,created_at,expires_at)
  values(r.id,p_target_origin,p_secret_hash,p_request_key_hash,v_now,v_exp) returning id into v_id;
  return jsonb_build_object('id',v_id,'expires_at',v_exp,'target_origin',p_target_origin);
end $$;
create function vppsone.qa_dayrun_approve_pair(p_pair_id uuid,p_alias text,p_owner_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r vppsone.qa_dayrun_runs%rowtype;
begin
  select * into r from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  if p_owner_user_id is distinct from r.owner_user_id or not r.enabled or r.revoked_at is not null or clock_timestamp()>=r.expires_at then return false; end if;
  if not exists(select 1 from vppsone.staff_profiles where id=r.owner_staff_profile_id and user_id=r.owner_user_id and role='admin' and is_active) then return false; end if;
  if not exists(select 1 from vppsone.qa_dayrun_accounts a join vppsone.staff_profiles sp on sp.id=a.staff_profile_id join auth.users u on u.id=a.user_id
    where a.alias=p_alias and a.user_id=sp.user_id and sp.is_active and sp.role=a.role and lower(u.email)=a.email and a.revoked_at is null and a.registered_at is not null) then return false; end if;
  update vppsone.qa_dayrun_pairs set status='authorized',alias=p_alias,approved_by=p_owner_user_id,approved_at=clock_timestamp()
    where id=p_pair_id and run_id=r.id and status='pending' and expires_at>clock_timestamp();
  return found;
end $$;
create function vppsone.qa_dayrun_consume_pair(p_pair_id uuid,p_secret_hash text,p_target_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r vppsone.qa_dayrun_runs%rowtype; p vppsone.qa_dayrun_pairs%rowtype; a vppsone.qa_dayrun_accounts%rowtype;
begin
  select * into r from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  if not r.enabled or r.revoked_at is not null or clock_timestamp()>=r.expires_at then return null; end if;
  update vppsone.qa_dayrun_pairs set status='consuming',consuming_at=clock_timestamp()
    where id=p_pair_id and run_id=r.id and status='authorized' and secret_hash=p_secret_hash and target_origin=p_target_origin and expires_at>clock_timestamp()
    returning * into p;
  if not found then return null; end if;
  select * into a from vppsone.qa_dayrun_accounts where alias=p.alias and user_id is not null and revoked_at is null;
  if not found or not exists(select 1 from vppsone.staff_profiles sp join auth.users u on u.id=sp.user_id
    where sp.id=a.staff_profile_id and sp.user_id=a.user_id and sp.role=a.role and sp.is_active and lower(u.email)=a.email) then
    update vppsone.qa_dayrun_pairs set status='failed',failed_at=clock_timestamp() where id=p.id; return null;
  end if;
  return jsonb_build_object('id',p.id,'target_origin',p.target_origin,'alias',a.alias,'user_id',a.user_id,'staff_profile_id',a.staff_profile_id,'email',a.email,'role',a.role,'is_new',a.is_new,'expires_at',r.expires_at);
end $$;
create function vppsone.qa_dayrun_complete_pair(p_pair_id uuid,p_session_id uuid,p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r vppsone.qa_dayrun_runs%rowtype; p vppsone.qa_dayrun_pairs%rowtype; a vppsone.qa_dayrun_accounts%rowtype;
begin
  select * into r from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  select * into p from vppsone.qa_dayrun_pairs where id=p_pair_id and status='consuming' for update;
  if not found then return false; end if;
  select * into a from vppsone.qa_dayrun_accounts where alias=p.alias;
  if not r.enabled or r.revoked_at is not null or clock_timestamp()>=r.expires_at or clock_timestamp()>=p.expires_at
    or a.user_id is distinct from p_user_id or a.revoked_at is not null
    or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_user_id)
    or not exists(select 1 from vppsone.staff_profiles sp where sp.id=a.staff_profile_id and sp.user_id=p_user_id and sp.is_active and sp.role=a.role)
    or exists(select 1 from vppsone.qa_dayrun_sessions where session_id=p_session_id) then
    update vppsone.qa_dayrun_pairs set status='failed',failed_at=clock_timestamp() where id=p.id; return false;
  end if;
  insert into vppsone.qa_dayrun_sessions(session_id,run_id,pair_id,alias,user_id,staff_profile_id,expires_at)
    values(p_session_id,r.id,p.id,a.alias,p_user_id,a.staff_profile_id,r.expires_at);
  update vppsone.qa_dayrun_pairs set status='used',used_at=clock_timestamp() where id=p.id;
  return true;
end $$;
create function vppsone.qa_dayrun_fail_pair(p_pair_id uuid,p_secret_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  -- Public pair ID alone is not enough to cancel a pairing or session.
  perform 1 from vppsone.qa_dayrun_pairs where id=p_pair_id and secret_hash=p_secret_hash
    and status in('consuming','used') for update;
  if not found then return false; end if;
  update vppsone.qa_dayrun_sessions set revoked_at=clock_timestamp() where pair_id=p_pair_id and revoked_at is null;
  update vppsone.qa_dayrun_pairs set status='failed',failed_at=clock_timestamp()
    where id=p_pair_id and status in('consuming','used');
  return found;
end $$;
create function vppsone.qa_dayrun_owner_session_valid(p_session_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions s join vppsone.staff_profiles sp on sp.user_id=s.user_id
    where s.id=p_session_id and s.user_id='94751583-3fbd-422b-b748-9104e85c1644'
      and sp.id='30c6b4d7-df2d-4ae2-873f-221e3d2ee55d' and sp.role='admin' and sp.is_active
      and (s.not_after is null or s.not_after>clock_timestamp()))
$$;
create function vppsone.qa_dayrun_revoke_session(p_session_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  update vppsone.qa_dayrun_sessions set revoked_at=coalesce(revoked_at,clock_timestamp())
    where session_id=p_session_id and run_id='overnight-20261019';
  return found;
end $$;
create function vppsone.qa_dayrun_activate(p_owner_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r vppsone.qa_dayrun_runs%rowtype;
begin
  select * into r from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  if p_owner_user_id is distinct from r.owner_user_id or r.revoked_at is not null or clock_timestamp()>=r.expires_at then return false; end if;
  if not exists(select 1 from vppsone.staff_profiles where id=r.owner_staff_profile_id and user_id=r.owner_user_id and role='admin' and is_active) then return false; end if;
  if (select count(*) from vppsone.qa_dayrun_accounts a join vppsone.staff_profiles sp on sp.id=a.staff_profile_id join auth.users u on u.id=a.user_id
    where a.user_id=sp.user_id and sp.is_active and sp.role=a.role and lower(u.email)=a.email and a.revoked_at is null and a.registered_at is not null)<>6 then return false; end if;
  update vppsone.qa_dayrun_runs set enabled=true where id=r.id;
  return true;
end $$;
create function vppsone.qa_dayrun_revoke() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_profiles integer;
begin
  perform 1 from vppsone.qa_dayrun_runs where id='overnight-20261019' for update;
  -- Denial first. Tombstones remain after revoke and expiry, permanently.
  update vppsone.qa_dayrun_runs set enabled=false,revoked_at=coalesce(revoked_at,v_now) where id='overnight-20261019';
  update vppsone.qa_dayrun_sessions set revoked_at=v_now where revoked_at is null;
  update vppsone.qa_dayrun_pairs set status='revoked' where status in('pending','authorized','consuming');
  v_profiles:=0; -- Existing profiles are never deactivated.
  return jsonb_build_object('revoked',true,'new_profiles_deactivated',v_profiles,'expires_at','2026-10-19T07:00:00Z');
end $$;
-- ACLs target only the exact eleven signatures created above.
do $$ declare signature text; begin
  foreach signature in array array[
    'vppsone.qa_dayrun_preserve_tombstone()',
    'vppsone.qa_dayrun_access_allowed()',
    'vppsone.qa_dayrun_create_pair(text,text,text)',
    'vppsone.qa_dayrun_approve_pair(uuid,text,uuid)',
    'vppsone.qa_dayrun_consume_pair(uuid,text,text)',
    'vppsone.qa_dayrun_complete_pair(uuid,uuid,uuid)',
    'vppsone.qa_dayrun_fail_pair(uuid,text)',
    'vppsone.qa_dayrun_owner_session_valid(uuid)',
    'vppsone.qa_dayrun_revoke_session(uuid)',
    'vppsone.qa_dayrun_activate(uuid)',
    'vppsone.qa_dayrun_revoke()'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',signature::regprocedure);
    if signature='vppsone.qa_dayrun_access_allowed()' then
      execute format('grant execute on function %s to authenticated,service_role',signature::regprocedure);
    elsif signature<>'vppsone.qa_dayrun_preserve_tombstone()' then
      execute format('grant execute on function %s to service_role',signature::regprocedure);
    end if;
  end loop;
end $$;
-- Existing bindings are asserted, never updated or repaired implicitly.
do $$ begin
  if(select count(*) from vppsone.qa_dayrun_accounts a join vppsone.staff_profiles sp on sp.id=a.staff_profile_id join auth.users u on u.id=a.user_id
    where not a.is_new and sp.user_id=a.user_id and sp.is_active and sp.role=a.role and lower(u.email)=a.email)<>6 then
    raise exception 'DAYRUN: existing QA identity pins drifted'; end if;
end $$;
commit;
