-- P10a follow-up: the one exception to an append-only history, said here.
--
-- The tests and `verify:records` drive the real decision command against a
-- synthetic field whose key starts `qa_`, and must be able to remove what
-- they made — the same exception P8 made for `QA-` report terms (D-227).
-- Every other history row stays undeletable and nothing is ever updated.

create or replace function vppsone.student_record_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and exists (
    select 1 from vppsone.collection_fields f
    where f.id = old.field_id and f.key like 'qa\_%'
  ) then
    return old;
  end if;
  raise exception 'student_record_history is append-only' using errcode = '42501';
end;
$$;

grant delete on vppsone.student_record_history to service_role;
