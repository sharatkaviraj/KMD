-- P6: the attendance reminder goes through the staff outbox.
--
-- It used to be a drafted message at 11 a.m. for whoever was class teacher,
-- with no way to take it back. The plan (§12) asks for three things the P4
-- outbox already does for cover: remind only the person responsible now,
-- after the first period ends; let a save made just before dispatch suppress
-- it; and never treat "the provider did not answer" as "not sent". So a
-- reminder becomes one more kind of staff notice, re-checked at the moment it
-- is claimed: a register saved in the meantime, or a teacher no longer
-- responsible for the class, and it is suppressed rather than sent.
--
-- A reminder is about a class and a day, not a duty, so the duty columns
-- become optional for it and a class takes their place.

alter table vppsone.staff_notices
  alter column duty_id drop not null,
  alter column duty_revision drop not null,
  alter column period drop not null,
  add column class_id uuid,
  add column class_label text;

alter table vppsone.staff_notices drop constraint staff_notices_kind_known;
alter table vppsone.staff_notices add constraint staff_notices_kind_known check (
  kind in ('cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation', 'attendance_reminder')
);
alter table vppsone.staff_notices add constraint staff_notices_names_its_subject check (
  (kind <> 'attendance_reminder' and duty_id is not null and duty_revision is not null and period is not null)
  or (kind = 'attendance_reminder' and duty_id is null and class_id is not null)
);

comment on column vppsone.staff_notices.class_id is
  'For an attendance reminder: the class whose register is outstanding (`public.classes.id`, no FK, D-5).';

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
  v_why text;
begin
  if not vppsone.flag_enabled('staff_notice_dispatch') then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;

  for n in
    select * from vppsone.staff_notices
    where (p_notice_id is null or id = p_notice_id)
      and (
        status = 'pending'
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
      -- Saved since it was queued: nothing to remind anybody of.
      v_why := 'already_saved';
    elsif n.kind = 'attendance_reminder' and not exists (
      select 1 from vppsone.class_teachers ct
      where ct.staff_profile_id = n.staff_profile_id and ct.class_id = n.class_id
        and ct.session_label = n.session_label
        and (ct.effective_from is null or ct.effective_from <= n.day)
        and (ct.effective_to is null or ct.effective_to >= n.day)
    ) then
      v_why := 'not_responsible';
    elsif v_destination is null or length(v_destination) < 10 then
      v_why := 'no_phone';
    end if;

    if v_why is not null then
      update vppsone.staff_notices set status = 'suppressed', status_reason = v_why where id = n.id;
      continue;
    end if;

    insert into vppsone.staff_notice_attempts (
      notice_id, attempt_no, lease_owner, lease_expires_at, destination, contact_version, transport
    ) values (
      n.id, n.attempts + 1, p_worker, now() + make_interval(secs => p_lease_seconds),
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
        'attempt_no', n.attempts + 1, 'not_after', n.not_after, 'session_label', n.session_label
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
      'destination', right(v_destination, 10)
    );
  end loop;

  return jsonb_build_object('claimed', false, 'reason', 'empty');
end;
$$;

revoke all on function vppsone.claim_staff_notice(text, integer, text, uuid) from public;
grant execute on function vppsone.claim_staff_notice(text, integer, text, uuid) to service_role;
