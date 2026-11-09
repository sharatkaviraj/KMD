-- Teacher task messages go out through the school's own WhatsApp (D-562).
--
-- `claim_teacher_task_delivery` took exactly one machine transport, 'aisensy'.
-- One no longer talks to AiSensy, so the claim takes 'whatsapp' instead (the
-- school's number, through src/platform/whatsapp). 'manual' (the office opens
-- WhatsApp itself) is unchanged. Rows already written with 'aisensy' stay
-- valid history, so the column still allows it.
--
-- The function is patched in place from its live definition: one condition
-- changes and the rest stays byte-for-byte what was reviewed in
-- 20261016090000 and 20261107174655.
--
-- Rollback: the same replace in reverse, and the constraint without
-- 'whatsapp' once no row carries it.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

alter table vppsone.message_sends drop constraint if exists message_sends_task_transport_check;
alter table vppsone.message_sends add constraint message_sends_task_transport_check
  check (task_transport in ('aisensy', 'whatsapp', 'manual'));

do $patch$
declare
  v_def text := pg_get_functiondef('vppsone.claim_teacher_task_delivery(uuid,uuid,text,text,boolean)'::regprocedure);
begin
  v_def := replace(v_def, $q$p_transport<>'aisensy'$q$, $q$p_transport<>'whatsapp'$q$);
  if v_def ~ 'aisensy' or v_def !~ $q$p_transport<>'whatsapp'$q$ then
    raise exception 'claim_teacher_task_delivery was not patched as expected';
  end if;
  execute v_def;
end;
$patch$;

commit;
