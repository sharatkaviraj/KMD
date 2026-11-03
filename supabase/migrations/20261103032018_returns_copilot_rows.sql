-- Manual entry assistant ("Portal Copilot") row marks for prepared reference sheets.
-- A mark is a person's own record that they typed a row into the official portal
-- (or found a mismatch there). It is human submission evidence only: never
-- portal acceptance, never a change to any student, fee or source record.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table vppsone.school_return_copilot_rows (
 batch_id uuid not null references vppsone.school_return_batches(id),
 row_key uuid not null,
 state text not null check(state in('entered','mismatch')),
 note text check(note is null or length(btrim(note)) between 1 and 500),
 actor_id uuid not null references vppsone.staff_profiles(id),
 updated_at timestamptz not null default now(),
 primary key(batch_id,row_key),
 check(state<>'mismatch' or note is not null)
);
alter table vppsone.school_return_copilot_rows enable row level security;
-- Visible exactly when the batch is (its own policy checks permission, scope and session).
create policy school_return_copilot_rows_read on vppsone.school_return_copilot_rows for select to authenticated
 using(exists(select 1 from vppsone.school_return_batches b where b.id=batch_id));
revoke all on vppsone.school_return_copilot_rows from public,anon,authenticated;
grant select on vppsone.school_return_copilot_rows to authenticated;
grant all on vppsone.school_return_copilot_rows to service_role;

-- Called by the server only, after its permission, view-as and session checks.
-- Rechecks the actor, the TEST fence and that the row belongs to this prepared
-- manual reference batch. Idempotent: the same mark twice is one row.
create function vppsone.school_return_copilot_mark(p_actor uuid,p_batch uuid,p_row uuid,p_state text,p_note text default null,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare b vppsone.school_return_batches; result vppsone.school_return_copilot_rows; clean_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
 select * into b from vppsone.school_return_batches where id=p_batch;
 if not found or not vppsone.school_office_actor_allowed(p_actor,'government:export',b.session_label,p_confined) then raise exception 'office:forbidden'; end if;
 if b.direction<>'export' or b.adapter->>'mode'<>'manual_reference' or b.file_path is null
  or b.state not in('exported','submitted','partially_accepted','rejected') then raise exception 'office:not_manual_entry'; end if;
 if p_state not in('entered','mismatch') or (p_state='mismatch' and clean_note is null) or length(coalesce(clean_note,''))>500 then raise exception 'office:invalid_mark'; end if;
 if not exists(select 1 from jsonb_array_elements(b.payload->'rows') r where r->>'studentId'=p_row::text) then raise exception 'office:row_not_in_batch'; end if;
 insert into vppsone.school_return_copilot_rows(batch_id,row_key,state,note,actor_id)
 values(p_batch,p_row,p_state,case when p_state='mismatch' then clean_note end,p_actor)
 on conflict(batch_id,row_key) do update set state=excluded.state,note=excluded.note,actor_id=excluded.actor_id,updated_at=now()
 returning * into result;
 return to_jsonb(result);
end;
$$;
revoke all on function vppsone.school_return_copilot_mark(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_return_copilot_mark(uuid,uuid,uuid,text,text,boolean) to service_role;

notify pgrst,'reload schema';
commit;
