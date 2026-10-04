-- P5 (Gate G): the teacher's side of a cover duty.
--
-- Two answers, both explicit, both idempotent, and neither one a fact about
-- the classroom:
--
--  - "Acknowledge" records that she has seen it. Not that she is in the room;
--    not that WhatsApp delivered it (PLAN §5: a blue tick is not
--    acknowledgement, and acknowledgement is not coverage).
--  - "I cannot cover" records the refusal and tells whoever arranges cover. It
--    does not free her or hand the duty to anybody: the duty stays hers until
--    a cover command reassigns it, and that command will never choose her for
--    it again (P3's exclusions).
--
-- Only the duty's current holder may answer, only while it is live and its
-- period has not ended, and only through this function — the service role
-- calls it after the page has authenticated her.

create or replace function vppsone.respond_to_cover_duty(
  p_duty uuid,
  p_staff uuid,
  p_response text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d vppsone.cover_duties%rowtype;
  v_ends timestamptz;
  v_manager record;
  v_queued integer := 0;
begin
  select * into d from vppsone.cover_duties where id = p_duty for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if d.status <> 'assigned' or d.covering_staff_id is distinct from p_staff then
    return jsonb_build_object('ok', false, 'reason', 'not_yours', 'status', d.status);
  end if;

  v_ends := vppsone.cover_period_ends_at(d.session_label, d.day, d.period);
  if now() >= v_ends then
    return jsonb_build_object('ok', false, 'reason', 'over');
  end if;

  if p_response = 'acknowledge' then
    if d.acknowledged_at is null then
      update vppsone.cover_duties set acknowledged_at = now() where id = d.id;
    end if;
    return jsonb_build_object('ok', true, 'acknowledged', true);
  end if;

  if p_response = 'cannot_cover' then
    if d.cannot_cover_at is not null then
      return jsonb_build_object('ok', true, 'cannot_cover', true, 'already', true);
    end if;

    update vppsone.cover_duties
    set cannot_cover_at = now(),
        cannot_cover_note = nullif(left(btrim(coalesce(p_note, '')), 200), '')
    where id = d.id;

    -- Tell whoever arranges cover: the academic coordinators, or the
    -- administrators when there is none. One notice per person per duty.
    for v_manager in
      select sp.id
      from vppsone.staff_profiles sp
      where sp.is_active and sp.role = 'academic_coordinator'
      union
      select sp.id
      from vppsone.staff_profiles sp
      where sp.is_active and sp.role = 'admin'
        and not exists (
          select 1 from vppsone.staff_profiles c
          where c.is_active and c.role = 'academic_coordinator'
        )
    loop
      insert into vppsone.staff_notices (
        notice_key, kind, duty_id, duty_revision, staff_profile_id, session_label, day, period,
        not_after, command_id
      ) values (
        d.id::text || ':cover_escalation:' || v_manager.id::text,
        'cover_escalation', d.id, d.revision, v_manager.id, d.session_label, d.day, d.period,
        v_ends, d.command_id
      )
      on conflict (notice_key) do nothing;
      v_queued := v_queued + 1;
    end loop;

    return jsonb_build_object('ok', true, 'cannot_cover', true, 'escalated_to', v_queued);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'bad_request');
end;
$$;

revoke all on function vppsone.respond_to_cover_duty(uuid, uuid, text, text) from public;
grant execute on function vppsone.respond_to_cover_duty(uuid, uuid, text, text) to service_role;
