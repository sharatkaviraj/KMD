-- WhatsApp to staff: consent, per-kind switches, caps, new events (go-live
-- Phase F; plan §8; D-344, D-356; critique1 A10, B13, C1).
--
-- The staff outbox (`staff_notices`, P3/P4, D-214) learns four things here:
--
--  1. Consent. `staff_profiles.whatsapp_opt_in_at` / `_source` ('form' — the
--     paper form at training, 'self' — /preferences, 'admin_recorded' — an
--     admin in /staff) / `_opt_out_at`. No consent, no send. And
--     `staff_notice_prefs(staff_profile_id, kind, enabled)`: a person may turn
--     a kind off for themselves (no row = not chosen = on, consent covers it).
--  2. Switches and limits, in `runtime_flags`:
--       staff_notice_kinds_enabled  {kind: true|false} — a kind not named true
--                                   does not go. Existing kinds on, new kinds
--                                   off until the owner names them (Q15).
--       staff_whatsapp_month_cap    a number, AiSensy sends a month (1000).
--       staff_notice_student_names  off: a staff message says "a student of
--                                   5-A", never a child's name.
--     `staff_notice_dispatch` stays the instant kill switch.
--  3. New kinds with a payload instead of a duty or a register (online
--     payment review/received, the day's collection, day not closed, money
--     requests and decisions, leave, and the three that used to be "send by
--     hand" through message_sends: marks reminder, weekly summary, staff
--     notice). Triggers on `fee_desk_requests` and `teacher_leave` queue the
--     money and leave notices in the same transaction as the request.
--  4. The claim now reads every fact the gate needs (consent, prefs, the kinds
--     map, today's and this month's sends, a burst of the same kind, whether
--     the number is on the test allowlist) in the transaction that leases the
--     notice. The app decides (src/modules/staff-notices/domain/gates.ts) and
--     either sends, or hands the claim back: `release_staff_notice` suppresses
--     it or holds it until a time (the 07:00 window, a digest hold), and
--     `digest_staff_notices` folds the rest of a burst into the one sent.
--
-- Also: the template name is settled — the outbox sends
-- `vppsone_staff_attendance_reminder` (four slots); the older one-slot
-- `vppsone_attendance_reminder` row is switched off (is_active false), not
-- deleted. Every staff template is registered in `message_templates`.
--
-- No fee table is altered; the triggers' payload READS `public.students` and
-- `public.classes` for a class label. Nothing is sent by this migration.
--
-- Grants: the service role does everything (the app's server writes); the
-- browser gets SELECT on its own prefs only. `authenticated` keeps its column
-- grants on staff_profiles unchanged (the consent columns are read with the
-- service role).
--
-- Rollback:
--   drop trigger fee_desk_requests_staff_notices on vppsone.fee_desk_requests;
--   drop trigger teacher_leave_staff_notices on vppsone.teacher_leave;
--   drop function vppsone.fee_desk_request_staff_notices(), vppsone.teacher_leave_staff_notices(),
--     vppsone.queue_staff_notice(text, text, uuid, text, jsonb, timestamptz, uuid),
--     vppsone.queue_staff_notice_to_permission(text, text, text, text, jsonb, timestamptz, uuid, uuid),
--     vppsone.release_staff_notice(uuid, text, text, text, timestamptz),
--     vppsone.digest_staff_notices(uuid, text), vppsone.student_notice_facts(uuid);
--   re-create claim_staff_notice from 20261004051407;
--   drop table vppsone.staff_notice_prefs;
--   alter table vppsone.staff_notices drop column payload, drop column requested_by, drop column digest_into;
--   restore staff_notices_kind_known / staff_notices_names_its_subject from 20261004051407;
--   delete from vppsone.runtime_flags where key in ('staff_notice_kinds_enabled','staff_whatsapp_month_cap','staff_notice_student_names');
--   alter table vppsone.staff_profiles drop column whatsapp_opt_in_at, drop column whatsapp_opt_in_source,
--     drop column whatsapp_opt_in_recorded_by, drop column whatsapp_opt_out_at;

/* ------------------------------------------------------------- consent */

alter table vppsone.staff_profiles
  add column if not exists whatsapp_opt_in_at timestamptz,
  add column if not exists whatsapp_opt_in_source text,
  add column if not exists whatsapp_opt_in_recorded_by uuid references vppsone.staff_profiles (id) on delete set null,
  add column if not exists whatsapp_opt_out_at timestamptz;

alter table vppsone.staff_profiles drop constraint if exists staff_profiles_whatsapp_opt_in_source_known;
alter table vppsone.staff_profiles add constraint staff_profiles_whatsapp_opt_in_source_known check (
  whatsapp_opt_in_source is null or whatsapp_opt_in_source in ('form', 'self', 'admin_recorded')
);
alter table vppsone.staff_profiles drop constraint if exists staff_profiles_whatsapp_opt_in_together;
alter table vppsone.staff_profiles add constraint staff_profiles_whatsapp_opt_in_together check (
  (whatsapp_opt_in_at is null) = (whatsapp_opt_in_source is null)
);

comment on column vppsone.staff_profiles.whatsapp_opt_in_at is
  'When this person agreed to WhatsApp messages from the school app. Null: never asked — nothing is sent (plan §8.3).';
comment on column vppsone.staff_profiles.whatsapp_opt_in_source is
  'How the consent was given: form (paper, at training), self (/preferences) or admin_recorded (/staff, the admin records consent collected in person).';
comment on column vppsone.staff_profiles.whatsapp_opt_out_at is
  'When they opted out. An opt-out at or after the opt-in wins.';

create table if not exists vppsone.staff_notice_prefs (
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (staff_profile_id, kind)
);

comment on table vppsone.staff_notice_prefs is
  'A person''s own on/off for one kind of staff WhatsApp. No row = not chosen = on (consent covers it).';

alter table vppsone.staff_notice_prefs enable row level security;
drop policy if exists staff_notice_prefs_select_own on vppsone.staff_notice_prefs;
create policy staff_notice_prefs_select_own on vppsone.staff_notice_prefs for select to authenticated
  using (staff_profile_id = (select vppsone.current_staff_profile_id()));
revoke all on vppsone.staff_notice_prefs from public, anon, authenticated;
grant select on vppsone.staff_notice_prefs to authenticated;
grant select, insert, update, delete on vppsone.staff_notice_prefs to service_role;

/* ------------------------------------------------------------ switches */

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_key_known;
alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
  key in (
    'cover_command',
    'staff_notice_dispatch',
    'fault_injection',
    'parent_dispatch',
    'parent_dispatch_categories',
    'absent_notice_owner',
    'parent_dispatch_test_only',
    'staff_notice_kinds_enabled',
    'staff_whatsapp_month_cap',
    'staff_notice_student_names'
  )
);

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_value_shape;
alter table vppsone.runtime_flags add constraint runtime_flags_value_shape check (
  case key
    when 'parent_dispatch_categories' then value is not null and jsonb_typeof(value) = 'array'
    when 'absent_notice_owner' then value is null or value in ('"fees_notice"'::jsonb, '"native"'::jsonb)
    when 'staff_notice_kinds_enabled' then value is not null and jsonb_typeof(value) = 'object'
    when 'staff_whatsapp_month_cap' then value is not null and jsonb_typeof(value) = 'number'
      and (value #>> '{}')::numeric > 0
    else true
  end
);

insert into vppsone.runtime_flags (key, enabled, value, note) values
  ('staff_notice_kinds_enabled', true,
   '{"cover_assigned": true, "cover_changed": true, "cover_cancelled": true, "cover_escalation": true, "attendance_reminder": true, "marks_reminder": false, "weekly_summary": false, "staff_broadcast": false, "online_review": false, "online_payment": false, "day_collection": false, "day_not_closed": false, "money_request": false, "money_decision": false, "leave_requested": false, "leave_decided": false, "teacher_task": true}'::jsonb,
   'Which kinds of staff WhatsApp may go, by name: a kind not set to true does not go. Existing kinds on; new kinds off until the owner names them (plan Q15). Consent is still asked of every person.'),
  ('staff_whatsapp_month_cap', true, '1000'::jsonb,
   'AiSensy sends to staff a month (IST), all kinds together. Reached: nothing more goes until the 1st. Off or missing: nothing goes.'),
  ('staff_notice_student_names', false, null,
   'On: a staff WhatsApp may name the child (money requests, online payments). Off: it says "a student of 5-A".')
on conflict (key) do nothing;

/* ------------------------------------------------------- the outbox rows */

alter table vppsone.staff_notices
  add column if not exists payload jsonb,
  add column if not exists requested_by uuid references vppsone.staff_profiles (id) on delete set null,
  add column if not exists digest_into uuid references vppsone.staff_notices (id) on delete set null;

comment on column vppsone.staff_notices.payload is
  'For a kind that is not about a duty or a register: what the message needs, written when it was queued. Never a phone number.';
comment on column vppsone.staff_notices.requested_by is
  'Who queued it by hand (a reminder, a staff notice), so they can take it back before it goes.';
comment on column vppsone.staff_notices.digest_into is
  'Folded into this notice''s digest message instead of going on its own.';

alter table vppsone.staff_notices drop constraint if exists staff_notices_kind_known;
alter table vppsone.staff_notices add constraint staff_notices_kind_known check (
  kind in (
    'cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation', 'attendance_reminder',
    'marks_reminder', 'weekly_summary', 'staff_broadcast', 'online_review', 'online_payment',
    'day_collection', 'day_not_closed', 'money_request', 'money_decision', 'leave_requested', 'leave_decided'
  )
);

alter table vppsone.staff_notices drop constraint if exists staff_notices_names_its_subject;
alter table vppsone.staff_notices add constraint staff_notices_names_its_subject check (
  (kind in ('cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation')
    and duty_id is not null and duty_revision is not null and period is not null)
  or (kind = 'attendance_reminder' and duty_id is null and class_id is not null)
  or (kind not in ('cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation', 'attendance_reminder')
    and duty_id is null and payload is not null and jsonb_typeof(payload) = 'object')
);

create index if not exists staff_notices_by_staff_kind_idx
  on vppsone.staff_notices (staff_profile_id, kind, status);
create index if not exists staff_notice_attempts_started_idx
  on vppsone.staff_notice_attempts (started_at);
create index if not exists staff_notice_attempts_notice_idx
  on vppsone.staff_notice_attempts (notice_id);

/* ----------------------------------------------------------- queueing */

/*
 * Queue one notice for one person. A test account is never told about a real
 * session (its number is a test number or nothing, and real data is not its
 * to see); an inactive profile is skipped. Idempotent on the key.
 */
create or replace function vppsone.queue_staff_notice(
  p_key text,
  p_kind text,
  p_staff uuid,
  p_session text,
  p_payload jsonb,
  p_not_after timestamptz default null,
  p_requested_by uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_test boolean;
  v_id uuid;
begin
  if p_staff is null or coalesce(p_session, '') = '' then
    return null;
  end if;
  select is_test_account into v_test
  from vppsone.staff_profiles where id = p_staff and is_active;
  if not found then
    return null;
  end if;
  if v_test and not vppsone.is_test_session_label(p_session) then
    return null;
  end if;

  insert into vppsone.staff_notices (
    notice_key, kind, staff_profile_id, session_label, day, not_after, command_id, payload, requested_by
  ) values (
    p_key, p_kind, p_staff, p_session, (now() at time zone 'Asia/Kolkata')::date,
    coalesce(p_not_after, now() + interval '3 days'), gen_random_uuid(), coalesce(p_payload, '{}'::jsonb), p_requested_by
  )
  on conflict (notice_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

/* Queue one each for every active holder of a permission, but the one excluded. */
create or replace function vppsone.queue_staff_notice_to_permission(
  p_key_prefix text,
  p_kind text,
  p_permission text,
  p_session text,
  p_payload jsonb,
  p_not_after timestamptz default null,
  p_exclude uuid default null,
  p_exclude_too uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_count integer := 0;
begin
  for v_staff in
    select sp.id from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where rp.permission = p_permission and sp.is_active
      and sp.id is distinct from p_exclude and sp.id is distinct from p_exclude_too
    order by sp.id
  loop
    if vppsone.queue_staff_notice(p_key_prefix || ':' || v_staff::text, p_kind, v_staff, p_session, p_payload, p_not_after) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

/* A student's name and class label for a payload. The name is used only when the school allows it. */
create or replace function vppsone.student_notice_facts(p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'student_name', s.full_name,
      'class_label', concat_ws(' ', c.class_name, nullif(c.section, ''))
    )
    from public.students s
    left join public.classes c on c.id = s.class_id
    where s.id = p_student
  ), '{}'::jsonb)
$$;

/* A reversal or write-off asked for → every admin; decided → whoever asked. */
create or replace function vppsone.fee_desk_request_staff_notices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  begin
    v_payload := jsonb_build_object(
      'request_id', new.id,
      'request_kind', new.kind,
      'amount', new.amount,
      'receipt_number', new.receipt_number,
      'requested_by_name', new.requested_by_name
    ) || vppsone.student_notice_facts(new.student_id);

    if tg_op = 'INSERT' and new.status = 'pending' then
      perform vppsone.queue_staff_notice_to_permission(
        'money_request:' || new.id::text, 'money_request', 'fees:manage', new.session_label,
        v_payload, now() + interval '3 days', new.requested_by
      );
    elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'declined')
      and new.requested_by is not null and new.decided_by is distinct from new.requested_by then
      perform vppsone.queue_staff_notice(
        'money_decision:' || new.id::text, 'money_decision', new.requested_by, new.session_label,
        v_payload || jsonb_build_object('decision', new.status), now() + interval '3 days'
      );
    end if;
  exception when others then
    -- A notice never stops the request it is about.
    raise warning 'staff notice for fee_desk_request % not queued: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists fee_desk_requests_staff_notices on vppsone.fee_desk_requests;
create trigger fee_desk_requests_staff_notices
  after insert or update of status on vppsone.fee_desk_requests
  for each row execute function vppsone.fee_desk_request_staff_notices();

/* Leave asked for → whoever arranges cover; decided → the teacher. The note is never put in a notice. */
create or replace function vppsone.teacher_leave_staff_notices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  begin
    v_payload := jsonb_build_object(
      'leave_id', new.id,
      'teacher_name', (select display_name from vppsone.staff_profiles where id = new.staff_profile_id),
      'from_day', new.from_day,
      'to_day', new.to_day,
      'span', new.span
    );
    if tg_op = 'INSERT' and new.status = 'asked' then
      perform vppsone.queue_staff_notice_to_permission(
        'leave_requested:' || new.id::text, 'leave_requested', 'substitutions:manage', new.session_label,
        v_payload, now() + interval '3 days', new.requested_by, new.staff_profile_id
      );
    elsif tg_op = 'UPDATE' and old.status = 'asked' and new.status in ('approved', 'declined')
      and new.decided_by is distinct from new.staff_profile_id then
      perform vppsone.queue_staff_notice(
        'leave_decided:' || new.id::text, 'leave_decided', new.staff_profile_id, new.session_label,
        v_payload || jsonb_build_object('decision', new.status), now() + interval '3 days'
      );
    end if;
  exception when others then
    raise warning 'staff notice for teacher_leave % not queued: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists teacher_leave_staff_notices on vppsone.teacher_leave;
create trigger teacher_leave_staff_notices
  after insert or update of status on vppsone.teacher_leave
  for each row execute function vppsone.teacher_leave_staff_notices();

/* ------------------------------------------------------------ the claim */

create or replace function vppsone.claim_staff_notice(
  p_worker text,
  p_lease_seconds integer,
  p_transport text,
  p_notice_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n vppsone.staff_notices%rowtype;
  d vppsone.cover_duties%rowtype;
  s vppsone.staff_profiles%rowtype;
  v_destination text;
  v_attempt uuid;
  v_attempt_no integer;
  v_why text;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_cover constant text[] := array['cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation'];
  v_gate jsonb;
begin
  if not vppsone.flag_enabled('staff_notice_dispatch') then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;

  for n in
    select * from vppsone.staff_notices
    where (p_notice_id is null or id = p_notice_id)
      and (
        (status = 'pending' and (next_attempt_at is null or next_attempt_at <= now()))
        or (status = 'failed' and next_attempt_at is not null and next_attempt_at <= now())
      )
    order by not_after, created_at
    limit 20
    for update skip locked
  loop
    d := null;
    if n.duty_id is not null then
      select * into d from vppsone.cover_duties where id = n.duty_id;
    end if;
    select * into s from vppsone.staff_profiles where id = n.staff_profile_id;
    v_destination := vppsone.staff_destination(n.staff_profile_id);
    v_why := null;

    if now() >= n.not_after then
      v_why := 'too_late';
    elsif not s.is_active then
      v_why := 'inactive';
    elsif s.is_test_account and not vppsone.is_test_session_label(n.session_label) then
      -- A test account is never told about a real session.
      v_why := 'test_account_real_session';
    elsif n.kind in ('cover_assigned', 'cover_changed')
      and (d.status <> 'assigned' or d.covering_staff_id is distinct from n.staff_profile_id) then
      v_why := 'duty_changed';
    elsif n.kind = 'cover_cancelled' and d.status in ('assigned', 'needs_help')
      and d.covering_staff_id = n.staff_profile_id then
      v_why := 'duty_restored';
    elsif n.kind = 'cover_escalation' and (d.status <> 'assigned' or d.cannot_cover_at is null) then
      v_why := 'resolved';
    elsif n.kind = 'attendance_reminder' and exists (
      select 1 from vppsone.attendance_registers r
      where r.session_label = n.session_label and r.class_id = n.class_id
        and r.day = n.day and r.period is null and r.revision >= 1
    ) then
      v_why := 'already_saved';
    elsif n.kind = 'attendance_reminder' and not exists (
      select 1 from vppsone.class_teachers ct
      where ct.staff_profile_id = n.staff_profile_id and ct.class_id = n.class_id
        and ct.session_label = n.session_label
        and (ct.effective_from is null or ct.effective_from <= n.day)
        and (ct.effective_to is null or ct.effective_to >= n.day)
    ) then
      v_why := 'not_responsible';
    elsif n.kind = 'money_request' and exists (
      select 1 from vppsone.fee_desk_requests r
      where r.id::text = n.payload ->> 'request_id' and r.status <> 'pending'
    ) then
      -- Decided (or withdrawn) before anybody needed telling.
      v_why := 'resolved';
    elsif n.kind = 'leave_requested' and exists (
      select 1 from vppsone.teacher_leave l
      where l.id::text = n.payload ->> 'leave_id' and l.status <> 'asked'
    ) then
      v_why := 'resolved';
    elsif n.kind = 'online_review' and exists (
      select 1 from public.online_payment_captures c
      where c.id::text = n.payload ->> 'capture_id' and c.application_status <> 'review_required'
    ) then
      v_why := 'resolved';
    elsif v_destination is null or length(v_destination) < 10 then
      v_why := 'no_phone';
    end if;

    if v_why is not null then
      update vppsone.staff_notices set status = 'suppressed', status_reason = v_why where id = n.id;
      continue;
    end if;

    -- Everything the gate asks, read now, in this transaction (gates.ts).
    v_gate := jsonb_build_object(
      'optInAt', s.whatsapp_opt_in_at,
      'optOutAt', s.whatsapp_opt_out_at,
      'isTestAccount', coalesce(s.is_test_account, false),
      'isTestSession', vppsone.is_test_session_label(n.session_label),
      'prefEnabled', (
        select p.enabled from vppsone.staff_notice_prefs p
        where p.staff_profile_id = s.id and p.kind = n.kind
      ),
      'kindsEnabled', (
        select case when f.enabled then f.value else null end
        from vppsone.runtime_flags f where f.key = 'staff_notice_kinds_enabled'
      ),
      'sentToday', (
        select count(*) from vppsone.staff_notice_attempts a
        join vppsone.staff_notices x on x.id = a.notice_id
        where x.staff_profile_id = s.id and not (x.kind = any (v_cover))
          and a.state in ('sending', 'accepted', 'unknown') and a.started_at >= v_day_start
      ),
      'recentSameKind', (
        select count(*) from vppsone.staff_notice_attempts a
        join vppsone.staff_notices x on x.id = a.notice_id
        where x.staff_profile_id = s.id and x.kind = n.kind
          and a.state in ('sending', 'accepted', 'unknown') and a.started_at >= now() - interval '30 minutes'
      ),
      'pendingSameKind', (
        select count(*) from vppsone.staff_notices x
        where x.staff_profile_id = s.id and x.kind = n.kind and x.id <> n.id
          and x.status = 'pending' and x.not_after > now()
          and (x.next_attempt_at is null or x.next_attempt_at <= now() or x.status_reason = 'digest_hold')
      ),
      'heldForDigest', coalesce(n.status_reason = 'digest_hold', false),
      'monthSent', (
        select count(*) from vppsone.staff_notice_attempts a
        where a.transport = 'aisensy' and a.state in ('sending', 'accepted', 'unknown')
          and a.started_at >= v_month_start
      ),
      'monthCap', (
        select case when f.enabled then f.value else null end
        from vppsone.runtime_flags f where f.key = 'staff_whatsapp_month_cap'
      ),
      'allowlisted', exists (
        select 1 from vppsone.message_test_recipients t where t.phone_e164 = '+91' || right(v_destination, 10)
      )
    );

    -- Numbered past every earlier attempt, a gate's hand-back included.
    select coalesce(max(attempt_no), 0) + 1 into v_attempt_no
    from vppsone.staff_notice_attempts where notice_id = n.id;

    insert into vppsone.staff_notice_attempts (
      notice_id, attempt_no, lease_owner, lease_expires_at, destination, contact_version, transport
    ) values (
      n.id, v_attempt_no, p_worker, now() + make_interval(secs => p_lease_seconds),
      right(v_destination, 10),
      md5(coalesce(s.whatsapp_phone, '') || '|' || coalesce(s.phone, '') || '|' || s.updated_at::text),
      p_transport
    )
    returning id into v_attempt;

    update vppsone.staff_notices
    set status = 'dispatching', attempts = attempts + 1, next_attempt_at = null
    where id = n.id;

    return jsonb_build_object(
      'claimed', true,
      'attempt_id', v_attempt,
      'notice', jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'day', n.day, 'period', n.period,
        'attempt_no', v_attempt_no, 'not_after', n.not_after, 'session_label', n.session_label,
        'payload', n.payload
      ),
      'duty', case when n.duty_id is null then null else jsonb_build_object(
        'id', d.id, 'class_labels', d.class_labels, 'subject_code', d.subject_code,
        'period', d.period, 'day', d.day, 'revision', d.revision, 'status', d.status
      ) end,
      'register', case when n.kind = 'attendance_reminder' then jsonb_build_object(
        'class_id', n.class_id, 'class_label', n.class_label, 'day', n.day
      ) else null end,
      'staff', jsonb_build_object(
        'id', s.id, 'display_name', s.display_name, 'language', s.preferred_language
      ),
      'destination', right(v_destination, 10),
      'gate', v_gate,
      'student_names', vppsone.flag_enabled('staff_notice_student_names')
    );
  end loop;

  return jsonb_build_object('claimed', false, 'reason', 'empty');
end;
$$;

/*
 * The gate said no, or not yet: hand the claim back before anything was sent.
 * 'suppress' ends the notice with the reason; 'defer' puts it back in the
 * queue from `p_until` (a hold that would outlive the notice ends it as
 * too_late). The attempt is closed as abandoned with the reason, and the
 * notice's provider-attempt count is given back, so a hold never uses up a retry.
 */
create or replace function vppsone.release_staff_notice(
  p_attempt uuid,
  p_worker text,
  p_action text,
  p_reason text,
  p_until timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a vppsone.staff_notice_attempts%rowtype;
  n vppsone.staff_notices%rowtype;
  v_reason text := left(coalesce(nullif(p_reason, ''), 'gate'), 60);
begin
  select * into a from vppsone.staff_notice_attempts where id = p_attempt for update;
  if not found or a.state <> 'claimed' or a.lease_owner <> p_worker then
    return jsonb_build_object('recorded', false);
  end if;
  select * into n from vppsone.staff_notices where id = a.notice_id for update;

  update vppsone.staff_notice_attempts
  set state = 'abandoned', error = 'gate: ' || v_reason, finished_at = now()
  where id = a.id;

  if p_action = 'defer' and p_until is not null and p_until < n.not_after then
    update vppsone.staff_notices
    set status = 'pending', next_attempt_at = p_until, status_reason = v_reason,
        attempts = greatest(attempts - 1, 0)
    where id = n.id;
    return jsonb_build_object('recorded', true, 'notice_status', 'pending', 'until', p_until);
  end if;

  update vppsone.staff_notices
  set status = 'suppressed',
      status_reason = case when p_action = 'defer' then 'too_late' else v_reason end,
      attempts = greatest(attempts - 1, 0)
  where id = n.id;
  return jsonb_build_object('recorded', true, 'notice_status', 'suppressed');
end;
$$;

/*
 * The rest of a burst of one kind for one person, folded into the digest this
 * attempt is about to send. Only after the stamp: what the digest says it
 * covers is on record before the provider is called.
 */
create or replace function vppsone.digest_staff_notices(p_attempt uuid, p_worker text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a vppsone.staff_notice_attempts%rowtype;
  n vppsone.staff_notices%rowtype;
  v_count integer;
begin
  select * into a from vppsone.staff_notice_attempts where id = p_attempt;
  if not found or a.state <> 'sending' or a.lease_owner <> p_worker then
    return 0;
  end if;
  select * into n from vppsone.staff_notices where id = a.notice_id;

  update vppsone.staff_notices x
  set status = 'suppressed', status_reason = 'digested', digest_into = n.id
  where x.staff_profile_id = n.staff_profile_id and x.kind = n.kind and x.id <> n.id
    and x.status = 'pending' and x.not_after > now()
    and (x.next_attempt_at is null or x.next_attempt_at <= now() or x.status_reason = 'digest_hold');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* ------------------------------------------------------------- templates */

-- One name for the register reminder: the outbox's four-slot one.
update vppsone.message_templates set is_active = false, updated_at = now()
where code = 'vppsone_attendance_reminder' and is_active;

insert into vppsone.message_templates (
  code, label_hi, label_en, body_hi, body_en, variables, has_url_button, audience, is_active, sort_order, wa_category
) values
  ('vppsone_cover_assigned', 'व्यवस्था मिली', 'Cover assigned', '{{1}} जी, {{2}} को {{3}} में {{4}} ({{5}}) की व्यवस्था आपकी है। देखें और पुष्टि करें: {{6}}', '{{1}}, you are covering {{4}} ({{5}}) in {{3}} on {{2}}. Open and acknowledge: {{6}}', array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], false, 'staff', true, 950, 'utility'),
  ('vppsone_cover_changed', 'व्यवस्था बदली', 'Cover changed', '{{1}} जी, {{2}} {{3}} की आपकी व्यवस्था बदली है: अब {{4}} ({{5}})। नया विवरण: {{6}}', '{{1}}, your cover in {{3}} on {{2}} has changed: now {{4}} ({{5}}). Current details: {{6}}', array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], false, 'staff', true, 951, 'utility'),
  ('vppsone_cover_cancelled', 'व्यवस्था रद्द', 'Cover cancelled', '{{1}} जी, {{2}} {{3}} में {{4}} ({{5}}) की व्यवस्था अब आपकी नहीं है। विवरण: {{6}}', '{{1}}, you no longer need to cover {{4}} ({{5}}) in {{3}} on {{2}}. Details: {{6}}', array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], false, 'staff', true, 952, 'utility'),
  ('vppsone_cover_escalation', 'व्यवस्था नहीं हो सकी', 'Cover refused', '{{1}} जी, {{2}} {{3}} में {{4}} ({{5}}) के लिए कोई नहीं है — किसी अध्यापक ने कहा वे नहीं ले सकते। देखें: {{6}}', '{{1}}, {{4}} ({{5}}) in {{3}} on {{2}} needs someone — the assigned teacher cannot cover it. Review: {{6}}', array['name', 'day', 'period', 'classes', 'subject', 'link']::text[], false, 'staff', true, 953, 'utility'),
  ('vppsone_staff_attendance_reminder', 'हाज़िरी की याद', 'Register not saved', '{{1}} जी, {{2}} की {{3}} की हाज़िरी अभी दर्ज नहीं हुई है। यहाँ लें: {{4}}', '{{1}}, {{3}}''s register for {{2}} has not been saved yet. Take it here: {{4}}', array['name', 'day', 'class', 'link']::text[], false, 'staff', true, 954, 'utility'),
  ('vx_staff_online_review_v1', 'ऑनलाइन भुगतान जाँचें', 'Online payment needs review', '{{1}} जी, {{3}} का {{2}} का ऑनलाइन भुगतान अपने-आप दर्ज नहीं हो सका। जाँच कर दर्ज करें: {{4}}', '{{1}}, an online payment of {{2}} for {{3}} could not be posted automatically. Review it here: {{4}}', array['name', 'amount', 'student or class', 'link']::text[], false, 'staff', true, 955, 'utility'),
  ('vx_staff_online_payment_v1', 'ऑनलाइन भुगतान आया', 'Online payment received', '{{1}} जी, {{3}} की फ़ीस {{2}} ऑनलाइन मिली, रसीद {{4}} बन गई है। {{5}}', '{{1}}, {{2}} was received online for {{3}}; receipt {{4}} has been posted. {{5}}', array['name', 'amount', 'student or class', 'receipt', 'link']::text[], false, 'staff', true, 956, 'utility'),
  ('vx_staff_day_collection_v1', 'दिन का संग्रह', 'Day''s collection', '{{1}} जी, {{2}} का संग्रह: {{3}}, {{4}} रसीदें ({{5}})। {{6}}', '{{1}}, collection for {{2}}: {{3}} in {{4}} receipts ({{5}}). {{6}}', array['name', 'day', 'total', 'receipts', 'by mode', 'link']::text[], false, 'staff', true, 957, 'utility'),
  ('vx_staff_day_not_closed_v1', 'दिन बंद नहीं हुआ', 'Day not closed', '{{1}} जी, {{2}} का दिन अभी बंद नहीं हुआ है ({{3}} रसीदें, {{4}})। नकद गिनकर दिन बंद करें: {{5}}', '{{1}}, {{2}} has not been closed yet ({{3}} receipts, {{4}}). Count the cash and close the day: {{5}}', array['name', 'day', 'receipts', 'total', 'link']::text[], false, 'staff', true, 958, 'utility'),
  ('vx_staff_money_request_v1', 'रसीद रद्द / माफ़ी का अनुरोध', 'Reversal or write-off requested', '{{1}} जी, {{5}} ने {{4}} के लिए {{3}} का {{2}} माँगा है। निर्णय करें: {{6}}', '{{1}}, {{5}} asked for a {{2}} of {{3}} for {{4}}. Decide here: {{6}}', array['name', 'what', 'amount', 'student or class', 'asked by', 'link']::text[], false, 'staff', true, 959, 'utility'),
  ('vx_staff_money_decision_v1', 'रसीद रद्द / माफ़ी का निर्णय', 'Reversal or write-off decided', '{{1}} जी, {{5}} के {{4}} के {{2}} का आपका अनुरोध {{3}} हुआ। {{6}}', '{{1}}, your {{2}} request of {{4}} for {{5}} was {{3}}. {{6}}', array['name', 'what', 'decision', 'amount', 'student or class', 'link']::text[], false, 'staff', true, 960, 'utility'),
  ('vx_staff_leave_requested_v1', 'छुट्टी का अनुरोध', 'Leave requested', '{{1}} जी, {{2}} ने {{3}} की छुट्टी माँगी है। देखें: {{4}}', '{{1}}, {{2}} has asked for leave on {{3}}. Review: {{4}}', array['name', 'teacher', 'dates', 'link']::text[], false, 'staff', true, 961, 'utility'),
  ('vx_staff_leave_decided_v1', 'छुट्टी का निर्णय', 'Leave decided', '{{1}} जी, {{2}} की आपकी छुट्टी {{3}} हुई। {{4}}', '{{1}}, your leave for {{2}} was {{3}}. {{4}}', array['name', 'dates', 'decision', 'link']::text[], false, 'staff', true, 962, 'utility'),
  ('vx_staff_digest_v1', 'कई संदेश एक साथ', 'Several messages at once', '{{1}} जी, आपके लिए {{2}} नए संदेश: {{3}}। सब यहाँ देखें: {{4}}', '{{1}}, you have {{2}} new messages: {{3}}. See them all here: {{4}}', array['name', 'count', 'what', 'link']::text[], false, 'staff', true, 963, 'utility')
on conflict (code) do nothing;

/* ---------------------------------------------------------------- grants */

revoke all on function vppsone.queue_staff_notice(text, text, uuid, text, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function vppsone.queue_staff_notice_to_permission(text, text, text, text, jsonb, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function vppsone.student_notice_facts(uuid) from public, anon, authenticated;
revoke all on function vppsone.fee_desk_request_staff_notices() from public, anon, authenticated;
revoke all on function vppsone.teacher_leave_staff_notices() from public, anon, authenticated;
revoke all on function vppsone.claim_staff_notice(text, integer, text, uuid) from public, anon, authenticated;
revoke all on function vppsone.release_staff_notice(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function vppsone.digest_staff_notices(uuid, text) from public, anon, authenticated;
grant execute on function vppsone.queue_staff_notice(text, text, uuid, text, jsonb, timestamptz, uuid) to service_role;
grant execute on function vppsone.queue_staff_notice_to_permission(text, text, text, text, jsonb, timestamptz, uuid, uuid) to service_role;
grant execute on function vppsone.student_notice_facts(uuid) to service_role;
grant execute on function vppsone.claim_staff_notice(text, integer, text, uuid) to service_role;
grant execute on function vppsone.release_staff_notice(uuid, text, text, text, timestamptz) to service_role;
grant execute on function vppsone.digest_staff_notices(uuid, text) to service_role;
