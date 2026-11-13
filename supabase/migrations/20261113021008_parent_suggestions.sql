-- Veer Patta AI: a parent's message never changes a child's record or the
-- school's on its own (D-598).
--
-- The owner, 12 Nov 2026: "Don't let parents responses affect the data of
-- the student or school". When the helper reads something in a parent's
-- WhatsApp that belongs in a child's record, it becomes a suggestion, and a
-- person at school applies it or lets it go.
--
-- Before this, two things were written on a parent's word alone: a sick-day
-- note on the register, which also stopped the queued "your child is absent"
-- WhatsApp for those days (D-588), and a school visit as an enquiry on the
-- Admissions board (D-592). Each is now a suggestion. A third kind is new: a
-- detail the parent asks the school to change (a phone number, an address).
--
-- What this adds, in `vppsone`, service role only:
--
--  * `parent_suggestions`: one row per thing the helper read. Whom it waits
--    for (the class teacher for a child's absence, the office for the rest;
--    an admin may decide any), whether it waits, was applied or was let go,
--    who decided it and how, and when it stops waiting: an absence at the end
--    of its last day, a visit at the end of its day, a change to a record
--    after seven days (the office may need to call the family first). The
--    payload holds what was read, in the school's words (days, a reason, a
--    field and its new value), never the parent's message: that stays in the
--    hand-off (`parent_replies`), as every hand-off's does.
--  * `parent_absence_notes` gains `suggestion_id`, the suggestion a note was
--    applied from, and `mark`, how the register starts the child: Leave or
--    Absent, as the person who applied it chose.
--  * `add_parent_suggestion(p)`: the helper's only write about a child.
--  * `decide_parent_suggestions(p)`: apply or let go, one or many at once, as
--    the member of staff deciding. The writes happen here and nowhere else:
--    the register's note, stopping the absent alert, the Admissions enquiry,
--    and a record value through `write_student_value`, which keeps history.
--  * Undo (`undo_parent_suggestion`) is the next file,
--    *_parent_suggestion_undo.sql. It removes rows when a person presses
--    Undo (the notes, the enquiry, the value an applied suggestion wrote), so
--    the Supabase connector asks the owner to confirm it; it goes in with
--    the owner present. Nothing in this file removes a row.
--
-- Additive: no existing row changes. Existing notes read mark = 'absent', as
-- the register has always started them.
--
-- Rollback:
--   (first *_parent_suggestion_undo.sql's rollback)
--   drop function if exists vppsone.decide_parent_suggestions(jsonb);
--   drop function if exists vppsone.add_parent_suggestion(jsonb);
--   drop function if exists vppsone.parent_suggestion_may_decide(uuid, text, text, uuid);
--   alter table vppsone.parent_absence_notes drop column suggestion_id, drop column mark;
--   drop table if exists vppsone.parent_suggestions;
--   drop function if exists vppsone.parent_suggestion_payload_ok(text, jsonb);

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

/* ------------------------------------------------------------- the shape */

-- What a suggestion of each kind holds. Written in the database as well as
-- in the app, because the payload is what a person applies.
create or replace function vppsone.parent_suggestion_payload_ok(p_kind text, p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  -- Only the keys of its kind: nothing else (the parent's words above all) can ride along.
  if not (
    (select coalesce(array_agg(k), array[]::text[]) from jsonb_object_keys(p) k) <@ case p_kind
      when 'absence' then array['days', 'reason']
      when 'visit' then array['day', 'part', 'child_name', 'class_label']
      when 'record' then array['field', 'value', 'was']
      else array[]::text[]
    end
  ) then
    return false;
  end if;
  if p_kind = 'absence' then
    if coalesce(jsonb_typeof(p->'days'), '') <> 'array' or jsonb_array_length(p->'days') not between 1 and 7 then
      return false;
    end if;
    for v_day in select value from jsonb_array_elements(p->'days') loop
      if coalesce(jsonb_typeof(v_day), '') <> 'string' or (v_day #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        return false;
      end if;
    end loop;
    return coalesce(p->>'reason', '') in ('sick', 'other');
  elsif p_kind = 'visit' then
    return coalesce(p->>'day', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and coalesce(p->>'part', '') in ('morning', 'afternoon')
      and char_length(btrim(coalesce(p->>'child_name', ''))) between 1 and 120
      and (coalesce(jsonb_typeof(p->'class_label'), 'null') = 'null' or char_length(p->>'class_label') between 1 and 60);
  elsif p_kind = 'record' then
    return coalesce(p->>'field', '') in ('guardian_phone', 'mother_phone', 'date_of_birth', 'blood_group', 'address')
      and char_length(btrim(coalesce(p->>'value', ''))) between 1 and 200
      and (coalesce(jsonb_typeof(p->'was'), 'null') = 'null' or char_length(p->>'was') <= 200);
  end if;
  return false;
end;
$$;

comment on function vppsone.parent_suggestion_payload_ok(text, jsonb) is
  'D-598: what a parent suggestion of each kind holds. absence {days[1-7], reason sick|other}; visit {day, part, child_name, class_label}; record {field, value, was}.';

create table vppsone.parent_suggestions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  session_label text not null check (char_length(session_label) between 4 and 40),
  -- The child it is about; none for a visit, which is about a child not yet at the school.
  student_id uuid,
  -- The child's class this session, when enrolled: whose class teacher decides an absence.
  class_id uuid,
  -- The hand-off it came with, in One's Messages inbox: the parent's own words.
  parent_reply_id uuid references vppsone.parent_replies(id) on delete set null,
  route text not null,
  -- The class teacher it waits for; null when it waits for the office.
  assigned_staff_id uuid references vppsone.staff_profiles(id) on delete set null,
  payload jsonb not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  decided_by uuid references vppsone.staff_profiles(id) on delete set null,
  decided_at timestamptz,
  decided_via text,
  -- What applying did, so it can be put back: the register's mark, the enquiry made, the value before.
  decision jsonb,
  -- The last time a decision on it was taken back; it may have been decided again since.
  undone_by uuid references vppsone.staff_profiles(id) on delete set null,
  undone_at timestamptz,
  -- Read for the owner's test number standing in for a family.
  practice boolean not null default false,
  created_at timestamptz not null default now(),
  constraint parent_suggestions_kind_known check (kind in ('absence', 'visit', 'record')),
  constraint parent_suggestions_route_known check (route in ('class_teacher', 'office')),
  constraint parent_suggestions_status_known check (status in ('pending', 'applied', 'dismissed', 'undone')),
  constraint parent_suggestions_via_known check (decided_via is null or decided_via in ('needs_you', 'teacher_home', 'register', 'whatsapp')),
  constraint parent_suggestions_child_known check ((kind = 'visit') = (student_id is null)),
  constraint parent_suggestions_decided_whole check ((status in ('pending', 'undone')) = (decided_at is null)),
  constraint parent_suggestions_undone_says_when check (status <> 'undone' or undone_at is not null),
  constraint parent_suggestions_payload_ok check (vppsone.parent_suggestion_payload_ok(kind, payload))
);

comment on table vppsone.parent_suggestions is
  'Veer Patta AI (D-598): something a parent said on WhatsApp that may belong in a child''s or the school''s record. Nothing is written until a member of staff applies it (decide_parent_suggestions). The parent''s words stay in the hand-off (parent_replies).';
comment on column vppsone.parent_suggestions.route is
  'class_teacher: an absence, for the class teacher of the child''s class (and an admin, and whoever corrects attendance). office: everything else, and an absence in a class with no class teacher.';
comment on column vppsone.parent_suggestions.status is
  'pending: waiting (until expires_at). applied, dismissed: decided by decided_by. undone: a decision taken back after it had expired, so it waits no longer.';
comment on column vppsone.parent_suggestions.expires_at is
  'When it stops waiting: an absence at the end of its last day (India), a visit at the end of its day, a record change seven days after it came.';

create index parent_suggestions_waiting on vppsone.parent_suggestions (session_label, status, expires_at);
create index parent_suggestions_by_class on vppsone.parent_suggestions (class_id, status) where class_id is not null;
create index parent_suggestions_decided on vppsone.parent_suggestions (session_label, decided_at) where decided_at is not null;
create unique index parent_suggestions_one_per_handoff on vppsone.parent_suggestions (parent_reply_id, kind) where parent_reply_id is not null;

alter table vppsone.parent_suggestions enable row level security;
revoke all on vppsone.parent_suggestions from anon, authenticated;
grant all on vppsone.parent_suggestions to service_role;

/* ------------------------------------------------ the register's note */

alter table vppsone.parent_absence_notes
  add column suggestion_id uuid references vppsone.parent_suggestions(id) on delete set null,
  add column mark text not null default 'absent',
  add constraint parent_absence_notes_mark_known check (mark in ('absent', 'leave'));

comment on column vppsone.parent_absence_notes.suggestion_id is
  'The suggestion this note was applied from (D-598); null for a note written before notes needed a person.';
comment on column vppsone.parent_absence_notes.mark is
  'How the register starts the child: leave or absent, as the person who applied the note chose. The teacher can still change it.';

create index parent_absence_notes_suggestion on vppsone.parent_absence_notes (suggestion_id) where suggestion_id is not null;

/* ------------------------------------------------------- who decides */

-- An absence: whoever corrects attendance, or the class teacher (or
-- assistant) of the child's class today. A visit: the office (collection) or
-- the fee desk. A record change: the office. An admin holds every
-- permission. Always someone of the session's own kind: a test account only
-- in a test session, real staff only in the real year.
create or replace function vppsone.parent_suggestion_may_decide(p_actor uuid, p_kind text, p_session text, p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vppsone.staff_profiles sp
    where sp.id = p_actor
      and sp.is_active
      and vppsone.staff_matches_session(sp.id, p_session)
      and (
        exists (
          select 1 from vppsone.role_permissions rp
          where rp.role = sp.role
            and rp.permission = any (
              case p_kind
                when 'absence' then array['attendance:correct']
                when 'visit' then array['collection:manage', 'fees:manage']
                when 'record' then array['collection:manage']
                else array[]::text[]
              end
            )
        )
        or (
          p_kind = 'absence'
          and p_class is not null
          and exists (
            select 1
            from vppsone.class_teachers ct
            join vppsone.role_permissions rp on rp.role = sp.role and rp.permission = 'attendance:mark'
            where ct.staff_profile_id = sp.id
              and ct.class_id = p_class
              and ct.session_label = p_session
              and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
              and (ct.effective_to is null or ct.effective_to >= vppsone.school_today())
          )
        )
      )
  );
$$;

comment on function vppsone.parent_suggestion_may_decide(uuid, text, text, uuid) is
  'D-598: whether this member of staff may apply or let go a parent suggestion of this kind, in this session and class.';

/* ------------------------------------------------------- the helper's write */

create or replace function vppsone.add_parent_suggestion(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := p->>'kind';
  v_session text := btrim(coalesce(p->>'session_label', ''));
  v_in jsonb := coalesce(p->'payload', '{}'::jsonb);
  v_practice boolean := coalesce((p->>'practice')::boolean, false);
  v_student uuid;
  v_reply uuid;
  v_payload jsonb;
  v_class uuid;
  v_route text := 'office';
  v_assigned uuid;
  v_expires timestamptz;
  v_days date[];
  v_field_id uuid;
  v_fee_column text;
  v_was text;
  v_value text;
  v_id uuid;
begin
  if v_kind is null or v_kind not in ('absence', 'visit', 'record') or char_length(v_session) not between 4 and 40 then
    raise exception 'parent_suggestion:bad_request' using errcode = '22023';
  end if;
  v_reply := nullif(p->>'parent_reply_id', '')::uuid;
  if v_kind <> 'visit' then
    v_student := (p->>'student_id')::uuid;
    if v_student is null then
      raise exception 'parent_suggestion:bad_request' using errcode = '22023';
    end if;
    select e.class_id into v_class
    from vppsone.enrolments e
    where e.student_id = v_student and e.session_label = v_session and e.status = 'enrolled'
    limit 1;
  end if;

  -- One suggestion of a kind per hand-off: a repeated turn adds nothing.
  if v_reply is not null then
    select s.id into v_id from vppsone.parent_suggestions s where s.parent_reply_id = v_reply and s.kind = v_kind;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if v_kind = 'absence' then
    if not vppsone.parent_suggestion_payload_ok('absence', v_in) then
      raise exception 'parent_suggestion:bad_payload' using errcode = '22023';
    end if;
    select array_agg(distinct d::date order by d::date) into v_days from jsonb_array_elements_text(v_in->'days') d;
    v_payload := jsonb_build_object(
      'days', (select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d) from unnest(v_days) d),
      'reason', v_in->>'reason'
    );
    v_expires := ((v_days[array_upper(v_days, 1)] + 1)::timestamp at time zone 'Asia/Kolkata');
    -- The class teacher of the child's class today, of the session's own kind; otherwise the office.
    if v_class is not null then
      select ct.staff_profile_id into v_assigned
      from vppsone.class_teachers ct
      join vppsone.staff_profiles sp on sp.id = ct.staff_profile_id and sp.is_active
      where ct.class_id = v_class
        and ct.session_label = v_session
        and ct.role = 'class_teacher'
        and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
        and (ct.effective_to is null or ct.effective_to >= vppsone.school_today())
        and vppsone.staff_matches_session(sp.id, v_session)
      order by ct.effective_from desc nulls last
      limit 1;
    end if;
    if v_assigned is not null then
      v_route := 'class_teacher';
    end if;
    -- The same days already waiting, or already applied, for this child: nothing new to ask.
    select s.id into v_id
    from vppsone.parent_suggestions s
    where s.kind = 'absence'
      and s.student_id = v_student
      and s.session_label = v_session
      and s.status in ('pending', 'applied')
      and s.expires_at > now()
      and (select array_agg(x::date) from jsonb_array_elements_text(s.payload->'days') x) @> v_days
    order by s.created_at
    limit 1;
    if v_id is not null then
      return v_id;
    end if;

  elsif v_kind = 'visit' then
    v_payload := jsonb_build_object(
      'day', v_in->>'day',
      'part', v_in->>'part',
      'child_name', btrim(coalesce(v_in->>'child_name', '')),
      'class_label', nullif(btrim(coalesce(v_in->>'class_label', '')), '')
    );
    if not vppsone.parent_suggestion_payload_ok('visit', v_payload) then
      raise exception 'parent_suggestion:bad_payload' using errcode = '22023';
    end if;
    v_expires := (((v_payload->>'day')::date + 1)::timestamp at time zone 'Asia/Kolkata');

  else
    v_value := btrim(coalesce(v_in->>'value', ''));
    if not vppsone.parent_suggestion_payload_ok('record', jsonb_build_object('field', v_in->>'field', 'value', v_value)) then
      raise exception 'parent_suggestion:bad_payload' using errcode = '22023';
    end if;
    select cf.id, cf.fee_column into v_field_id, v_fee_column
    from vppsone.collection_fields cf
    where cf.key = v_in->>'field' and cf.is_active;
    if v_field_id is null then
      -- Not a detail the school keeps here: the hand-off alone carries it.
      return null;
    end if;
    select sr.value into v_was from vppsone.student_records sr where sr.student_id = v_student and sr.field_id = v_field_id;
    if v_was is null and v_fee_column is not null then
      select to_jsonb(s) ->> v_fee_column into v_was from public.students s where s.id = v_student;
    end if;
    -- The school already holds this value: nothing to change.
    if v_was is not distinct from v_value then
      return null;
    end if;
    v_payload := jsonb_build_object('field', v_in->>'field', 'value', v_value, 'was', left(v_was, 200));
    if not vppsone.parent_suggestion_payload_ok('record', v_payload) then
      raise exception 'parent_suggestion:bad_payload' using errcode = '22023';
    end if;
    v_expires := now() + interval '7 days';
    select s.id into v_id
    from vppsone.parent_suggestions s
    where s.kind = 'record'
      and s.student_id = v_student
      and s.session_label = v_session
      and s.status = 'pending'
      and s.expires_at > now()
      and s.payload->>'field' = v_payload->>'field'
      and s.payload->>'value' = v_value
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Too late to wait for anyone (an absence for today written at midnight).
  if v_expires <= now() then
    return null;
  end if;

  insert into vppsone.parent_suggestions (
    kind, session_label, student_id, class_id, parent_reply_id, route, assigned_staff_id, payload, expires_at, practice
  ) values (
    v_kind, v_session, v_student, v_class, v_reply, v_route, v_assigned, v_payload, v_expires, v_practice
  )
  on conflict (parent_reply_id, kind) where parent_reply_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select s.id into v_id from vppsone.parent_suggestions s where s.parent_reply_id = v_reply and s.kind = v_kind;
  end if;
  return v_id;
end;
$$;

comment on function vppsone.add_parent_suggestion(jsonb) is
  'D-598: the helper''s only write about a child. {kind, session_label, student_id, parent_reply_id, practice, payload}. Returns the suggestion (a new one, or the one already waiting with the same content), or null when there is nothing to ask.';

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
          -- a day some note already covers keeps that note.
          select array_agg(x::date) into v_days from jsonb_array_elements_text(v_row.payload->'days') x;
          insert into vppsone.parent_absence_notes (student_id, session_label, day, reason, parent_reply_id, practice, suggestion_id, mark)
          select v_row.student_id, v_row.session_label, d, v_row.payload->>'reason', v_row.parent_reply_id, v_row.practice, v_row.id, v_mark
          from unnest(v_days) d
          on conflict (student_id, day) do nothing;
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
          insert into vppsone.enquiries (
            session_label, stage, child_name, class_label, parent_name, phone, source, visit_on, visit_part, parent_reply_id, created_by
          ) values (
            v_row.session_label, 'enquiry', v_row.payload->>'child_name', v_row.payload->>'class_label',
            nullif(nullif(left(regexp_replace(btrim(coalesce(v_from_name, '')), '\s+', ' ', 'g'), 80), ''), 'Parent'),
            nullif(v_phone, ''), 'whatsapp', (v_row.payload->>'day')::date, v_row.payload->>'part', v_row.parent_reply_id, v_actor
          )
          on conflict (parent_reply_id) do nothing
          returning id into v_enquiry;
          if v_enquiry is null then
            select e.id into v_enquiry from vppsone.enquiries e where e.parent_reply_id = v_row.parent_reply_id;
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
  'D-598: apply or let go parent suggestions, as {actor_staff_id, ids[<=200], decision apply|dismiss, mark leave|absent, via}. Each is re-checked (still waiting, not expired, this person may decide it) and answered on its own: applied, dismissed, already, expired, not_permitted, failed or not_found.';

revoke all on function vppsone.parent_suggestion_payload_ok(text, jsonb) from public, anon, authenticated;
revoke all on function vppsone.parent_suggestion_may_decide(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function vppsone.add_parent_suggestion(jsonb) from public, anon, authenticated;
revoke all on function vppsone.decide_parent_suggestions(jsonb) from public, anon, authenticated;
grant execute on function vppsone.parent_suggestion_payload_ok(text, jsonb) to service_role;
grant execute on function vppsone.parent_suggestion_may_decide(uuid, text, text, uuid) to service_role;
grant execute on function vppsone.add_parent_suggestion(jsonb) to service_role;
grant execute on function vppsone.decide_parent_suggestions(jsonb) to service_role;

commit;
