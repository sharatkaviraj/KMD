-- P4 (Gate F): sending a staff notice, honestly.
--
-- `staff_notices` (P3) is what somebody should be told. This is the ledger of
-- trying to tell them, and the three database steps a dispatcher takes:
--
--   claim_staff_notice  — atomically take one due notice under a lease, after
--                         re-checking it against the facts *now*: the duty is
--                         still theirs, the period has not ended, they are
--                         active, they have a number. Anything that fails is
--                         suppressed with the reason, never sent stale.
--   stamp_staff_notice  — record exactly what will be sent (destination,
--                         template, language, parameters) before the provider
--                         is called, so a crash after the call still leaves
--                         evidence of what may have gone out.
--   finish_staff_notice — record the outcome. Accepted needs a provider id.
--                         A definite refusal or a rate limit may be retried,
--                         boundedly, by a new attempt that re-checks
--                         everything. A timeout, or a 2xx without an id, is
--                         Unknown: it may have been accepted, and it is never
--                         retried by the machine.
--
-- `sweep_staff_notices` ends leases nobody finished: an attempt that never
-- reached the provider goes back to the queue; one that might have is Unknown.
-- Re-sending after Unknown is a person's decision, recorded as theirs.
--
-- There is no exactly-once promise here, because WhatsApp cannot make one.

alter table vppsone.staff_notices
  add column attempts integer not null default 0,
  add column next_attempt_at timestamptz,
  add column reconciled_by uuid references vppsone.staff_profiles (id) on delete set null,
  add column reconciled_at timestamptz;

create type vppsone.notice_attempt_state as enum (
  'claimed', 'sending', 'accepted', 'rejected', 'rate_limited', 'unknown', 'abandoned'
);

create table vppsone.staff_notice_attempts (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references vppsone.staff_notices (id) on delete restrict,
  attempt_no integer not null,
  state vppsone.notice_attempt_state not null default 'claimed',
  lease_owner text not null,
  lease_expires_at timestamptz not null,
  /** The number it was going to, as it was then — a later change does not rewrite history. */
  destination text not null,
  contact_version text not null,
  transport text not null,
  template_code text,
  language text,
  params jsonb,
  link text,
  policy_version text not null default 'staff-cover-v1',
  provider_message_id text,
  provider_status integer,
  error text,
  /** Set when a person authorised a re-send after Unknown. */
  authorized_by uuid references vppsone.staff_profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  stamped_at timestamptz,
  finished_at timestamptz,
  constraint staff_notice_attempts_transport_known check (transport in ('mock', 'aisensy', 'disabled')),
  constraint staff_notice_attempts_no_unique unique (notice_id, attempt_no)
);

comment on table vppsone.staff_notice_attempts is
  'Every attempt to send a staff notice, with what was sent and to which number. Never edited after it finishes.';

create index staff_notice_attempts_open_idx
  on vppsone.staff_notice_attempts (lease_expires_at) where state in ('claimed', 'sending');

alter table vppsone.staff_notice_attempts enable row level security;
create policy staff_notice_attempts_select_scoped
  on vppsone.staff_notice_attempts for select to authenticated
  using ((select vppsone.staff_can('substitutions:manage')));
grant select on vppsone.staff_notice_attempts to authenticated;
grant all on vppsone.staff_notice_attempts to service_role;

/* The ten digits a staff phone is stored as, or null. */
create or replace function vppsone.staff_destination(p_staff uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(nullif(whatsapp_phone, ''), nullif(phone, ''), ''), '\D', '', 'g'), '')
  from vppsone.staff_profiles where id = p_staff
$$;

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
    select * into d from vppsone.cover_duties where id = n.duty_id;
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
      -- Somebody already reassigned it, or the refusal was withdrawn.
      v_why := 'resolved';
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
        'attempt_no', n.attempts + 1, 'not_after', n.not_after
      ),
      'duty', jsonb_build_object(
        'id', d.id, 'class_labels', d.class_labels, 'subject_code', d.subject_code,
        'period', d.period, 'day', d.day, 'revision', d.revision, 'status', d.status
      ),
      'staff', jsonb_build_object(
        'id', s.id, 'display_name', s.display_name, 'language', s.preferred_language
      ),
      'destination', right(v_destination, 10)
    );
  end loop;

  return jsonb_build_object('claimed', false, 'reason', 'empty');
end;
$$;

create or replace function vppsone.stamp_staff_notice(
  p_attempt uuid,
  p_worker text,
  p_template text,
  p_language text,
  p_params jsonb,
  p_link text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update vppsone.staff_notice_attempts
  set state = 'sending', template_code = p_template, language = p_language,
      params = p_params, link = p_link, stamped_at = now()
  where id = p_attempt and state = 'claimed' and lease_owner = p_worker and lease_expires_at > now();
  return found;
end;
$$;

create or replace function vppsone.finish_staff_notice(
  p_attempt uuid,
  p_worker text,
  p_outcome text,
  p_provider_message_id text,
  p_provider_status integer,
  p_error text
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
  v_state vppsone.notice_attempt_state;
  v_notice vppsone.staff_notice_status;
  v_next timestamptz;
begin
  select * into a from vppsone.staff_notice_attempts where id = p_attempt for update;
  if not found or a.state <> 'sending' or a.lease_owner <> p_worker then
    -- Already settled by the sweeper or another worker: the first word stands.
    return jsonb_build_object('recorded', false);
  end if;
  select * into n from vppsone.staff_notices where id = a.notice_id for update;

  v_state := case p_outcome
    when 'accepted' then 'accepted'
    when 'rejected' then 'rejected'
    when 'rate_limited' then 'rate_limited'
    else 'unknown'
  end::vppsone.notice_attempt_state;

  -- Accepted only with the provider's receipt id; a 2xx without one is Unknown.
  if v_state = 'accepted' and coalesce(p_provider_message_id, '') = '' then
    v_state := 'unknown';
  end if;

  if v_state = 'accepted' then
    v_notice := 'accepted';
  elsif v_state = 'unknown' then
    v_notice := 'unknown';
  else
    v_notice := 'failed';
    -- Bounded retry, only while the notice still means something.
    if (v_state = 'rate_limited' or coalesce(p_provider_status, 0) >= 500) and n.attempts < 3 then
      v_next := now() + make_interval(mins => case n.attempts when 1 then 1 when 2 then 5 else 15 end);
      if v_next >= n.not_after then v_next := null; end if;
    end if;
  end if;

  update vppsone.staff_notice_attempts
  set state = v_state, provider_message_id = nullif(p_provider_message_id, ''),
      provider_status = p_provider_status, error = left(p_error, 500), finished_at = now()
  where id = a.id;

  update vppsone.staff_notices
  set status = v_notice, next_attempt_at = v_next,
      status_reason = case when v_notice = 'failed' then left(p_error, 200) else null end
  where id = n.id;

  return jsonb_build_object('recorded', true, 'notice_status', v_notice, 'retry_at', v_next);
end;
$$;

create or replace function vppsone.sweep_staff_notices()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_released integer;
  v_unknown integer;
begin
  -- Never reached the provider: safe to put back.
  with gone as (
    update vppsone.staff_notice_attempts set state = 'abandoned', finished_at = now()
    where state = 'claimed' and lease_expires_at <= now()
    returning notice_id
  )
  update vppsone.staff_notices n set status = 'pending'
  from gone where n.id = gone.notice_id and n.status = 'dispatching';
  get diagnostics v_released = row_count;

  -- Might have reached it: Unknown, and left for a person.
  with lost as (
    update vppsone.staff_notice_attempts
    set state = 'unknown', finished_at = now(), error = 'lease expired after the provider was called'
    where state = 'sending' and lease_expires_at <= now()
    returning notice_id
  )
  update vppsone.staff_notices n set status = 'unknown'
  from lost where n.id = lost.notice_id and n.status = 'dispatching';
  get diagnostics v_unknown = row_count;

  -- Pending past the point of usefulness.
  update vppsone.staff_notices set status = 'suppressed', status_reason = 'too_late'
  where status in ('pending', 'failed') and not_after <= now();

  return jsonb_build_object('released', v_released, 'unknown', v_unknown);
end;
$$;

/*
 * A person settles an Unknown or failed notice: they confirmed it arrived, or
 * they authorise one more attempt knowing it may be a duplicate.
 */
create or replace function vppsone.reconcile_staff_notice(
  p_notice uuid,
  p_actor uuid,
  p_resolution text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n vppsone.staff_notices%rowtype;
begin
  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = p_actor and sp.is_active and rp.permission = 'substitutions:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  select * into n from vppsone.staff_notices where id = p_notice for update;
  if not found or n.status not in ('unknown', 'failed', 'suppressed') then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;

  if p_resolution = 'confirmed_received' then
    update vppsone.staff_notices
    set status = 'delivered', status_reason = 'confirmed by a person',
        reconciled_by = p_actor, reconciled_at = now()
    where id = n.id;
  elsif p_resolution = 'resend' then
    if now() >= n.not_after then
      return jsonb_build_object('ok', false, 'reason', 'too_late');
    end if;
    update vppsone.staff_notices
    set status = 'pending', next_attempt_at = null, status_reason = 'resend authorised',
        reconciled_by = p_actor, reconciled_at = now()
    where id = n.id;
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function vppsone.staff_destination(uuid) from public;
revoke all on function vppsone.claim_staff_notice(text, integer, text, uuid) from public;
revoke all on function vppsone.stamp_staff_notice(uuid, text, text, text, jsonb, text) from public;
revoke all on function vppsone.finish_staff_notice(uuid, text, text, text, integer, text) from public;
revoke all on function vppsone.sweep_staff_notices() from public;
revoke all on function vppsone.reconcile_staff_notice(uuid, uuid, text) from public;
grant execute on function vppsone.staff_destination(uuid) to service_role;
grant execute on function vppsone.claim_staff_notice(text, integer, text, uuid) to service_role;
grant execute on function vppsone.stamp_staff_notice(uuid, text, text, text, jsonb, text) to service_role;
grant execute on function vppsone.finish_staff_notice(uuid, text, text, text, integer, text) to service_role;
grant execute on function vppsone.sweep_staff_notices() to service_role;
grant execute on function vppsone.reconcile_staff_notice(uuid, uuid, text) to service_role;
