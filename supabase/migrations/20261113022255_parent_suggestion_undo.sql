-- Veer Patta AI (D-598, D-599): Undo, for a parent's suggestion a member of
-- staff applied or let go. Undo keeps every row.
--
-- The rest of D-598 is *_parent_suggestions.sql, just before this. Taking a
-- decision back changes rows and keeps them, so nothing is lost and each
-- step stays on record:
--
--  * the register's notes an applied absence added are withdrawn
--    (`parent_absence_notes.withdrawn_at`, `withdrawn_by`), and the register
--    no longer reads them. Applying the suggestion again brings those days
--    back, with the mark chosen then;
--  * the Admissions enquiry an applied visit made is closed, while the office
--    has not started on it. Applying the visit again opens it again;
--  * the value an applied change wrote to a child's record is put back
--    through the record writer, with history: the value before, or no value
--    of One's own when One held none, so the fee app's value shows again
--    (readers take One's value, else the fee app's). Never over a value
--    somebody wrote since.
--
-- So `decide_parent_suggestions` is written again here, the same but for
-- that: a withdrawn note and an enquiry Undo closed come back when the
-- suggestion is applied again.
--
-- An earlier draft of this file removed those rows on Undo. The Supabase
-- connector asks the owner to confirm any migration that can remove rows,
-- and that question cannot be answered from a thread; the owner asked on
-- 13 Nov for migrations to go in without asking him. Keeping the rows is the
-- better record anyway.
--
-- Rollback:
--   drop function if exists vppsone.undo_parent_suggestion(jsonb);
--   (then decide_parent_suggestions as *_parent_suggestions.sql wrote it)
--   alter table vppsone.parent_absence_notes drop column withdrawn_by, drop column withdrawn_at;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

/* ------------------------------------------------ a note taken back */

alter table vppsone.parent_absence_notes
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references vppsone.staff_profiles(id) on delete set null,
  add constraint parent_absence_notes_withdrawn_says_when check (withdrawn_by is null or withdrawn_at is not null);

comment on column vppsone.parent_absence_notes.withdrawn_at is
  'D-599: when a person took the note back (Undo on the suggestion it was applied from). The note is kept and the register no longer reads it; applying the suggestion again brings it back.';
comment on column vppsone.parent_absence_notes.withdrawn_by is
  'D-599: who took the note back.';

/* ------------------------------------------------------- deciding */

create or replace function vppsone.decide_parent_suggestions(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_ids uuid[];
  v_decision text := coalesce(p->>'decision', '');
  v_mark text := coalesce(nullif(p->>'mark', ''), 'leave');
  v_via text := coalesce(nullif(p->>'via', ''), 'needs_you');
  v_row vppsone.parent_suggestions%rowtype;
  v_seen uuid[] := array[]::uuid[];
  v_results jsonb := '[]'::jsonb;
  v_outcome jsonb;
  v_detail jsonb;
  v_days date[];
  v_noted integer;
  v_stopped integer;
  v_from_name text;
  v_from_phone text;
  v_phone text;
  v_enquiry uuid;
  v_field_id uuid;
  v_fee_column text;
  v_prev text;
  v_had boolean;
  v_write text;
  v_applied integer := 0;
  v_dismissed integer := 0;
  v_id uuid;
begin
  begin
    v_actor := (p->>'actor_staff_id')::uuid;
    select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) x;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_actor is null or v_ids is null or cardinality(v_ids) > 200
     or v_decision not in ('apply', 'dismiss')
     or v_mark not in ('leave', 'absent')
     or v_via not in ('needs_you', 'teacher_home', 'register', 'whatsapp') then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if not exists (select 1 from vppsone.staff_profiles where id = v_actor and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  for v_row in
    select * from vppsone.parent_suggestions where id = any (v_ids) order by created_at, id for update
  loop
    v_seen := v_seen || v_row.id;
    if v_row.status <> 'pending' then
      v_outcome := jsonb_build_object('id', v_row.id, 'outcome', 'already', 'status', v_row.status, 'decided_by', v_row.decided_by);
    elsif v_row.expires_at <= now() then
      v_outcome := jsonb_build_object('id', v_row.id, 'outcome', 'expired');
    elsif not vppsone.parent_suggestion_may_decide(v_actor, v_row.kind, v_row.session_label, v_row.class_id) then
      v_outcome := jsonb_build_object('id', v_row.id, 'outcome', 'not_permitted');
    elsif v_decision = 'dismiss' then
      update vppsone.parent_suggestions
      set status = 'dismissed', decided_by = v_actor, decided_at = now(), decided_via = v_via, decision = '{}'::jsonb
      where id = v_row.id;
      v_dismissed := v_dismissed + 1;
      v_outcome := jsonb_build_object('id', v_row.id, 'outcome', 'dismissed');
    else
      begin
        if v_row.kind = 'absence' then
          -- The register's note, one per day, with the mark the person chose;
          -- a day some note already covers keeps that note, and a day whose
          -- note was taken back (Undo) has it back, as decided now.
          select array_agg(x::date) into v_days from jsonb_array_elements_text(v_row.payload->'days') x;
          insert into vppsone.parent_absence_notes as n (student_id, session_label, day, reason, parent_reply_id, practice, suggestion_id, mark)
          select v_row.student_id, v_row.session_label, d, v_row.payload->>'reason', v_row.parent_reply_id, v_row.practice, v_row.id, v_mark
          from unnest(v_days) d
          on conflict (student_id, day) do update
            set session_label = excluded.session_label, reason = excluded.reason, parent_reply_id = excluded.parent_reply_id,
                practice = excluded.practice, suggestion_id = excluded.suggestion_id, mark = excluded.mark,
                withdrawn_at = null, withdrawn_by = null
            where n.withdrawn_at is not null;
          get diagnostics v_noted = row_count;
          -- The parent told the school: no "your child is absent" WhatsApp for those days.
          update vppsone.parent_message_queue
          set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor
          where session_label = v_row.session_label
            and kind = 'absent_alert'
            and status = 'queued'
            and student_id = v_row.student_id
            and day = any (v_days);
          get diagnostics v_stopped = row_count;
          v_detail := jsonb_build_object('mark', v_mark, 'noted', v_noted, 'alerts_stopped', v_stopped);

        elsif v_row.kind = 'visit' then
          select pr.from_name, pr.from_phone into v_from_name, v_from_phone
          from vppsone.parent_replies pr where pr.id = v_row.parent_reply_id;
          if v_from_phone is null then
            raise exception 'handoff_gone';
          end if;
          -- "+919000000001" -> "9000000001", the way the Admissions board keeps a phone.
          v_phone := regexp_replace(v_from_phone, '[^0-9]', '', 'g');
          if char_length(v_phone) = 12 and left(v_phone, 2) = '91' then
            v_phone := substr(v_phone, 3);
          end if;
          v_enquiry := null;
          -- On the board as this person's; an enquiry Undo closed opens again.
          insert into vppsone.enquiries as e (
            session_label, stage, child_name, class_label, parent_name, phone, source, visit_on, visit_part, parent_reply_id, created_by
          ) values (
            v_row.session_label, 'enquiry', v_row.payload->>'child_name', v_row.payload->>'class_label',
            nullif(nullif(left(regexp_replace(btrim(coalesce(v_from_name, '')), '\s+', ' ', 'g'), 80), ''), 'Parent'),
            nullif(v_phone, ''), 'whatsapp', (v_row.payload->>'day')::date, v_row.payload->>'part', v_row.parent_reply_id, v_actor
          )
          on conflict (parent_reply_id) do update
            set stage = 'enquiry', stage_changed_at = now(), updated_at = now(),
                visit_on = excluded.visit_on, visit_part = excluded.visit_part
            where e.stage = 'closed' and e.student_id is null
          returning e.id into v_enquiry;
          if v_enquiry is null then
            select x.id into v_enquiry from vppsone.enquiries x where x.parent_reply_id = v_row.parent_reply_id;
            v_detail := jsonb_build_object('enquiry_id', v_enquiry, 'created', false);
          else
            v_detail := jsonb_build_object('enquiry_id', v_enquiry, 'created', true);
          end if;

        else
          select cf.id, cf.fee_column into v_field_id, v_fee_column
          from vppsone.collection_fields cf where cf.key = v_row.payload->>'field';
          if v_field_id is null then
            raise exception 'field_gone';
          end if;
          v_prev := null;
          select sr.value into v_prev from vppsone.student_records sr where sr.student_id = v_row.student_id and sr.field_id = v_field_id;
          v_had := found;
          if not v_had and v_fee_column is not null then
            select to_jsonb(s) ->> v_fee_column into v_prev from public.students s where s.id = v_row.student_id;
          end if;
          -- The one writer of a child's record, as the person deciding: kept in its history.
          v_write := vppsone.write_student_value(
            v_row.student_id, v_field_id, v_row.session_label, v_row.payload->>'value',
            'office', 'whatsapp_parent', 'parent_suggestion:' || v_row.id::text, null, gen_random_uuid(), v_actor
          );
          v_detail := jsonb_build_object('field_id', v_field_id, 'previous', v_prev, 'had_record', v_had, 'write', v_write);
        end if;

        update vppsone.parent_suggestions
        set status = 'applied', decided_by = v_actor, decided_at = now(), decided_via = v_via, decision = v_detail
        where id = v_row.id;
        v_applied := v_applied + 1;
        v_outcome := jsonb_build_object('id', v_row.id, 'outcome', 'applied', 'kind', v_row.kind) || v_detail;
      exception when others then
        v_outcome := jsonb_build_object('id', v_row.id, 'outcome', 'failed', 'reason', left(sqlerrm, 120));
      end;
    end if;
    v_results := v_results || jsonb_build_array(v_outcome);
  end loop;

  foreach v_id in array v_ids loop
    if not (v_id = any (v_seen)) then
      v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_id, 'outcome', 'not_found'));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'applied', v_applied, 'dismissed', v_dismissed, 'results', v_results);
end;
$$;

comment on function vppsone.decide_parent_suggestions(jsonb) is
  'D-598: apply or let go parent suggestions, as {actor_staff_id, ids[<=200], decision apply|dismiss, mark leave|absent, via}. Each is re-checked (still waiting, not expired, this person may decide it) and answered on its own: applied, dismissed, already, expired, not_permitted, failed or not_found. Applying again after an Undo brings back the notes it withdrew and the enquiry it closed (D-599).';

/* ------------------------------------------------------- taking it back */

create or replace function vppsone.undo_parent_suggestion(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_row vppsone.parent_suggestions%rowtype;
  v_enquiry vppsone.enquiries%rowtype;
  v_record vppsone.student_records%rowtype;
  v_taken_back integer := 0;
  v_status text;
begin
  begin
    v_actor := (p->>'actor_staff_id')::uuid;
    v_id := (p->>'id')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_actor is null or v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  select * into v_row from vppsone.parent_suggestions where id = v_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status not in ('applied', 'dismissed') then
    return jsonb_build_object('ok', false, 'reason', 'not_decided', 'status', v_row.status);
  end if;
  if not vppsone.parent_suggestion_may_decide(v_actor, v_row.kind, v_row.session_label, v_row.class_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  if v_row.status = 'applied' then
    if v_row.kind = 'absence' then
      -- Only the days this suggestion noted, withdrawn and kept; a stopped absent alert is not queued again.
      update vppsone.parent_absence_notes
      set withdrawn_at = now(), withdrawn_by = v_actor
      where suggestion_id = v_row.id and withdrawn_at is null;
      get diagnostics v_taken_back = row_count;

    elsif v_row.kind = 'visit' then
      if coalesce((v_row.decision->>'created')::boolean, false) then
        select * into v_enquiry from vppsone.enquiries where id = (v_row.decision->>'enquiry_id')::uuid for update;
        if found then
          -- The office has started on it: it stays, and is changed on the board.
          if v_enquiry.stage <> 'enquiry' or v_enquiry.student_id is not null then
            return jsonb_build_object('ok', false, 'reason', 'enquiry_moved');
          end if;
          -- Closed, as a family that is not coming, and kept.
          update vppsone.enquiries
          set stage = 'closed', stage_changed_at = now(), updated_at = now()
          where id = v_enquiry.id;
          get diagnostics v_taken_back = row_count;
        end if;
      end if;

    elsif coalesce(v_row.decision->>'write', '') = 'written' then
      select * into v_record
      from vppsone.student_records
      where student_id = v_row.student_id and field_id = (v_row.decision->>'field_id')::uuid
      for update;
      -- Somebody has written the value since: it is theirs now, and stays.
      if not found or v_record.source_ref is distinct from 'parent_suggestion:' || v_row.id::text then
        return jsonb_build_object('ok', false, 'reason', 'record_moved');
      end if;
      -- The value before, through the one writer, with history. When One held
      -- none of its own, none again, and the fee app's value shows.
      perform vppsone.write_student_value(
        v_row.student_id, v_record.field_id, v_record.session_label,
        case when coalesce((v_row.decision->>'had_record')::boolean, false) then v_row.decision->>'previous' end,
        'office', 'whatsapp_parent_undo', 'parent_suggestion:' || v_row.id::text || ':undo', null, gen_random_uuid(), v_actor
      );
      v_taken_back := 1;
    end if;
  end if;

  -- It waits again, to be decided afresh, unless its time has passed.
  v_status := case when v_row.expires_at > now() then 'pending' else 'undone' end;
  update vppsone.parent_suggestions
  set status = v_status, decided_by = null, decided_at = null, decided_via = null, decision = null,
      undone_by = v_actor, undone_at = now()
  where id = v_row.id;

  return jsonb_build_object('ok', true, 'status', v_status, 'was', v_row.status, 'taken_back', v_taken_back);
end;
$$;

comment on function vppsone.undo_parent_suggestion(jsonb) is
  'D-599: {actor_staff_id, id}. Takes back an applied suggestion, keeping every row: its register notes are withdrawn, the enquiry it made is closed while the office has not started on it, the record value is put back while nobody has written since. Or takes back a "Not now". It waits again until it expires.';

revoke all on function vppsone.undo_parent_suggestion(jsonb) from public, anon, authenticated;
grant execute on function vppsone.undo_parent_suggestion(jsonb) to service_role;

commit;
