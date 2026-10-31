-- Staff WhatsApp: the review fixes for PR #148 (go-live Phase F; D-356, D-357).
--
-- `20261031101234_staff_whatsapp_consent_and_gates` is applied and is never
-- edited; this one changes what the review found wrong in it.
--
--  1. A confined deployment claims TEST-session notices only. Preview and a
--     local `next dev` point at this one database and may run the dispatcher;
--     before this, their claim leased real-session notices too and then the
--     gate suppressed them as "not on the test list" — a real cover or money
--     notice lost for good. `claim_staff_notice` takes `p_test_only` (the
--     dispatcher passes `isConfinedDeployment()`), and a real-session row is
--     then never locked, claimed, suppressed or counted.
--  2. No child's name is stored in the outbox. `student_notice_facts` writes
--     the student's id and class label; the claim adds the name to what it
--     hands the app only while `staff_notice_student_names` is on, and strips
--     any name otherwise. And the browser cannot read `staff_notices.payload`
--     or `staff_notice_attempts.params` at all: the table-wide SELECT the
--     outbox had since P3 is replaced by column grants without them (the RLS
--     policy lets `substitutions:manage` read every row, and that permission
--     carries no fee permission). Every read of these tables in the app is
--     with the service role.
--  3. A digest folds the rest of a burst in only once the provider took it
--     (accepted, or unknown — which may have gone). Before, the fold ran
--     before the send, and a refused digest left the folded notices marked
--     "sent inside a digest" that never went.
--  4. One AiSensy request a second across every dispatcher at once, not per
--     run: `reserve_staff_send_slot` hands out the next free second from one
--     row, and a caller waits for its slot.
--  5. One count for the month's cap: `staff_whatsapp_month_sent()` is the
--     outbox's AiSensy attempts plus the teacher-task link's AiSensy claims
--     (`message_sends.task_history`), used by the claim, the Staff tab and the
--     teacher-task gate.
--
-- Nothing is sent by this migration; no fee table is touched.
--
-- Rollback: re-create claim_staff_notice(text, integer, text, uuid),
-- student_notice_facts and digest_staff_notices from 20261031101234;
-- drop function vppsone.reserve_staff_send_slot(integer), vppsone.staff_whatsapp_month_sent();
-- drop table vppsone.staff_send_pace;
-- grant select on vppsone.staff_notices, vppsone.staff_notice_attempts to authenticated;

/* ---------------------------------------------- the browser's columns */

revoke select on vppsone.staff_notices from authenticated;
grant select (
  id, notice_key, kind, duty_id, duty_revision, staff_profile_id, session_label, day, period,
  status, status_reason, not_after, command_id, created_at, updated_at, attempts, next_attempt_at,
  reconciled_by, reconciled_at, class_id, class_label, requested_by, digest_into
) on vppsone.staff_notices to authenticated;

revoke select on vppsone.staff_notice_attempts from authenticated;
grant select (
  id, notice_id, attempt_no, state, lease_owner, lease_expires_at, destination, contact_version,
  transport, template_code, language, link, policy_version, provider_message_id, provider_status,
  error, authorized_by, started_at, stamped_at, finished_at
) on vppsone.staff_notice_attempts to authenticated;

/* ------------------------------------------------- no name in the outbox */

create or replace function vppsone.student_notice_facts(p_student uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'student_id', s.id,
      'class_label', concat_ws(' ', c.class_name, nullif(c.section, ''))
    )
    from public.students s
    left join public.classes c on c.id = s.class_id
    where s.id = p_student
  ), '{}'::jsonb)
$$;

-- Nothing was queued with a payload before this (checked on wtgx: 0 rows),
-- but a name must never outlive the switch: drop any that is there.
update vppsone.staff_notices set payload = payload - 'student_name'
where payload ? 'student_name';

/* --------------------------------------------------- the month's count */

create or replace function vppsone.staff_whatsapp_month_sent()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as month_start
  )
  select (
    (select count(*) from vppsone.staff_notice_attempts a, bounds b
     where a.transport = 'aisensy' and a.state in ('sending', 'accepted', 'unknown')
       and a.started_at >= b.month_start)
    +
    (select count(*) from vppsone.message_sends m
       cross join lateral jsonb_array_elements(m.task_history) e, bounds b
     where m.task_id is not null and m.task_transport = 'aisensy'
       and e ->> 'event' = 'claim' and e ->> 'transport' = 'aisensy'
       and (e ->> 'at')::timestamptz >= b.month_start)
  )::integer
$$;

comment on function vppsone.staff_whatsapp_month_sent() is
  'AiSensy sends to staff this IST month: the outbox''s attempts that may have gone, and every AiSensy claim of the teacher-task link. The one count the month cap is held against.';

/* ------------------------------------------------------------ the pace */

create table if not exists vppsone.staff_send_pace (
  id boolean primary key default true check (id),
  next_at timestamptz not null default now()
);

comment on table vppsone.staff_send_pace is
  'One row: the next second AiSensy may be asked for a staff message, shared by every dispatcher (plan §8.3).';

alter table vppsone.staff_send_pace enable row level security;
revoke all on vppsone.staff_send_pace from public, anon, authenticated;
grant select, insert, update on vppsone.staff_send_pace to service_role;
insert into vppsone.staff_send_pace (id) values (true) on conflict (id) do nothing;

create or replace function vppsone.reserve_staff_send_slot(p_gap_ms integer default 1000)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_gap interval := make_interval(secs => greatest(coalesce(p_gap_ms, 1000), 0) / 1000.0);
  v_slot timestamptz;
begin
  -- The row lock queues concurrent callers; each gets the next free second.
  update vppsone.staff_send_pace
  set next_at = greatest(next_at, clock_timestamp()) + v_gap
  where id
  returning next_at - v_gap into v_slot;
  if v_slot is null then
    insert into vppsone.staff_send_pace (id, next_at) values (true, clock_timestamp() + v_gap)
    on conflict (id) do update set next_at = greatest(vppsone.staff_send_pace.next_at, clock_timestamp()) + v_gap
    returning next_at - v_gap into v_slot;
  end if;
  return v_slot;
end;
$$;

/* ------------------------------------------------------------ the claim */

drop function if exists vppsone.claim_staff_notice(text, integer, text, uuid);

create or replace function vppsone.claim_staff_notice(
  p_worker text,
  p_lease_seconds integer,
  p_transport text,
  p_notice_id uuid default null,
  p_test_only boolean default false
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
  v_cover constant text[] := array['cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation'];
  v_gate jsonb;
  v_names boolean := vppsone.flag_enabled('staff_notice_student_names');
  v_payload jsonb;
begin
  if not vppsone.flag_enabled('staff_notice_dispatch') then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;

  for n in
    select * from vppsone.staff_notices
    where (p_notice_id is null or id = p_notice_id)
      -- A confined deployment (Preview, local) never touches a real session.
      and (not coalesce(p_test_only, true) or vppsone.is_test_session_label(session_label))
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
          and x.session_label = n.session_label
          and x.status = 'pending' and x.not_after > now()
          and (x.next_attempt_at is null or x.next_attempt_at <= now() or x.status_reason = 'digest_hold')
      ),
      'heldForDigest', coalesce(n.status_reason = 'digest_hold', false),
      'monthSent', vppsone.staff_whatsapp_month_sent(),
      'monthCap', (
        select case when f.enabled then f.value else null end
        from vppsone.runtime_flags f where f.key = 'staff_whatsapp_month_cap'
      ),
      'allowlisted', exists (
        select 1 from vppsone.message_test_recipients t where t.phone_e164 = '+91' || right(v_destination, 10)
      )
    );

    -- The child's name is read here, only while the school allows it, and is
    -- never written back: the stored payload names the student by id.
    v_payload := case
      when n.payload is null then null
      when v_names and n.payload ? 'student_id' then
        (n.payload - 'student_name') || jsonb_build_object('student_name', (
          select st.full_name from public.students st where st.id::text = n.payload ->> 'student_id'
        ))
      else n.payload - 'student_name'
    end;

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
        'payload', v_payload
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
      'student_names', v_names
    );
  end loop;

  return jsonb_build_object('claimed', false, 'reason', 'empty');
end;
$$;

/* ----------------------------------------------------------- the digest */

/*
 * The rest of a burst of one kind for one person, folded into the digest this
 * attempt sent. Only once the provider took it (accepted, or unknown — it may
 * have gone): a refused or rate-limited digest folds nothing, so each notice
 * is still there to go on the retry. The stamp already recorded how many the
 * digest said it covered.
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
  if not found or a.state not in ('accepted', 'unknown') or a.lease_owner <> p_worker then
    return 0;
  end if;
  select * into n from vppsone.staff_notices where id = a.notice_id;

  update vppsone.staff_notices x
  set status = 'suppressed', status_reason = 'digested', digest_into = n.id
  where x.staff_profile_id = n.staff_profile_id and x.kind = n.kind and x.id <> n.id
    and x.session_label = n.session_label
    and x.status = 'pending' and x.not_after > now()
    and (x.next_attempt_at is null or x.next_attempt_at <= now() or x.status_reason = 'digest_hold');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* ---------------------------------------------------------------- grants */

revoke all on function vppsone.claim_staff_notice(text, integer, text, uuid, boolean) from public, anon, authenticated;
revoke all on function vppsone.student_notice_facts(uuid) from public, anon, authenticated;
revoke all on function vppsone.digest_staff_notices(uuid, text) from public, anon, authenticated;
revoke all on function vppsone.staff_whatsapp_month_sent() from public, anon, authenticated;
revoke all on function vppsone.reserve_staff_send_slot(integer) from public, anon, authenticated;
grant execute on function vppsone.claim_staff_notice(text, integer, text, uuid, boolean) to service_role;
grant execute on function vppsone.student_notice_facts(uuid) to service_role;
grant execute on function vppsone.digest_staff_notices(uuid, text) to service_role;
grant execute on function vppsone.staff_whatsapp_month_sent() to service_role;
grant execute on function vppsone.reserve_staff_send_slot(integer) to service_role;
