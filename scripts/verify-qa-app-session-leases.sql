-- APP-ONLY Post-migration, PRE-ACTIVATION proof for the explicitly authorized DEV project.
-- Run by the deployment owner only after project_ref is independently verified.
-- This transaction inserts only two disposable qa_dayrun rows and rolls back.
-- No Auth rows, staff profiles, public data, Storage, or original policies change.
begin;
do $$ begin
 if not exists(select 1 from vppsone.qa_dayrun_runs where id='overnight-20261019' and project_ref='wtgxcptmucjerhufzjcf' and not enabled and revoked_at is null) then
  raise exception 'Requires installed, disabled, unrevoked DEV dayrun';
 end if;
end $$;
insert into vppsone.qa_dayrun_pairs(id,run_id,target_origin,secret_hash,request_key_hash,status,alias,created_at,expires_at)
values('eea10000-0000-4000-8000-000000000001','overnight-20261019','https://vppsone-veerpattas-projects.vercel.app',repeat('e',64),repeat('d',64),'used','teacher',clock_timestamp(),least(clock_timestamp()+interval '4 minutes','2026-10-19T07:00:00Z'::timestamptz));
insert into vppsone.qa_dayrun_sessions(session_id,run_id,pair_id,alias,user_id,staff_profile_id,expires_at)
values('eea10000-0000-4000-8000-000000000002','overnight-20261019','eea10000-0000-4000-8000-000000000001','teacher','392a7a49-5ec3-44db-a605-9f8dc057a292','29d76340-1929-4848-ad4f-8a3ae5653a43','2026-10-19T07:00:00Z');
select set_config('request.jwt.claim.sub','392a7a49-5ec3-44db-a605-9f8dc057a292',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"392a7a49-5ec3-44db-a605-9f8dc057a292","role":"authenticated","session_id":"eea10000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
do $$ begin
 if vppsone.qa_dayrun_access_allowed() is distinct from false then raise exception 'registered disabled lease was allowed'; end if;
 if not exists(select 1 from vppsone.staff_profiles where id='29d76340-1929-4848-ad4f-8a3ae5653a43') then raise exception 'existing direct self-read unexpectedly changed'; end if;
 begin perform vppsone.qa_dayrun_revoke(); raise exception 'unauthorized RPC succeeded'; exception when insufficient_privilege then null; end;
 begin perform 1 from vppsone.qa_dayrun_sessions; raise exception 'registry readable'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"392a7a49-5ec3-44db-a605-9f8dc057a292","role":"authenticated","session_id":"eea10000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
do $$ begin
 if vppsone.qa_dayrun_access_allowed() is distinct from true then raise exception 'unrelated original QA session affected'; end if;
 if not exists(select 1 from vppsone.staff_profiles where id='29d76340-1929-4848-ad4f-8a3ae5653a43') then raise exception 'unrelated QA self read affected'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','94751583-3fbd-422b-b748-9104e85c1644',true);
select set_config('request.jwt.claims','{"sub":"94751583-3fbd-422b-b748-9104e85c1644","role":"authenticated","session_id":"eea10000-0000-4000-8000-000000000004"}',true);
set local role authenticated;
do $$ begin
 if vppsone.qa_dayrun_access_allowed() is distinct from true or not vppsone.is_admin_staff() then raise exception 'owner session affected'; end if;
end $$;
reset role;
select 'PASS: app-lease predicate denies disabled lease; private RPC/registry denied; inherited raw self-read and unrelated QA/owner access preserved' as verification;
rollback;
