-- Native fee readers are authorized by active vppsone staff profiles.
-- Keep the legacy fee schema and role catalogue unchanged. The definer is
-- needed for the derived-state upsert; the native guard runs before any read
-- or write, and only authenticated callers may execute this entry point.
CREATE OR REPLACE FUNCTION vppsone.refresh_defaulter_recovery_state(p_session_label text, p_today date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows integer := 0;
begin
  if auth.uid() is null or not vppsone.staff_can('fees:view') then
    raise exception 'Unauthorized recovery state refresh.' using errcode = '28000';
  end if;

  with latest_promises as (
    select distinct on (dc.student_id)
      dc.id as contact_id,
      dc.student_id,
      dc.session_label,
      dc.contacted_at,
      dc.snooze_until,
      (
        select sfm.family_group_id
        from public.student_family_members sfm
        where sfm.student_id = dc.student_id
          and sfm.academic_session_label = dc.session_label
        order by sfm.created_at desc
        limit 1
      ) as family_group_id,
      exists (
        select 1
        from public.receipts r
        join public.payments p
          on p.receipt_id = r.id
          and p.student_id = r.student_id
        join public.installments i
          on i.id = p.installment_id
          and i.student_id = p.student_id
        join public.classes
          on classes.id = i.class_id
          and classes.session_label = dc.session_label
        where r.student_id = dc.student_id
          and r.payment_date >= dc.contacted_at::date
      ) as paid_since_promise
    from public.defaulter_contacts dc
    where dc.session_label = p_session_label
      and dc.outcome = 'promised_pay'
      and dc.snooze_until is not null
      and (
        dc.snooze_until <= p_today
        or exists (
          select 1
          from public.receipts r
          join public.payments p
            on p.receipt_id = r.id
            and p.student_id = r.student_id
          join public.installments i
            on i.id = p.installment_id
            and i.student_id = p.student_id
          join public.classes
            on classes.id = i.class_id
            and classes.session_label = dc.session_label
          where r.student_id = dc.student_id
            and r.payment_date >= dc.contacted_at::date
        )
      )
    order by dc.student_id, dc.contacted_at desc, dc.id desc
  ),
  resolved as (
    select
      contact_id,
      student_id,
      session_label,
      family_group_id,
      case
        when paid_since_promise then 'kept'
        when snooze_until < p_today then 'broken'
        else null
      end as outcome
    from latest_promises
  ),
  upserted as (
    insert into public.defaulter_recovery_state (
      student_id,
      session_label,
      family_group_id,
      recovery_stage,
      promise_resolved_outcome,
      promise_resolved_at,
      last_resolved_contact_id,
      promise_kept_count,
      promise_broken_count
    )
    select
      resolved.student_id,
      resolved.session_label,
      resolved.family_group_id,
      case when resolved.outcome = 'broken' then 'promise_due' else 'standard' end,
      resolved.outcome,
      now(),
      resolved.contact_id,
      case when resolved.outcome = 'kept' then 1 else 0 end,
      case when resolved.outcome = 'broken' then 1 else 0 end
    from resolved
    where resolved.outcome is not null
    on conflict (student_id, session_label) do update
    set
      family_group_id = coalesce(excluded.family_group_id, defaulter_recovery_state.family_group_id),
      recovery_stage = excluded.recovery_stage,
      promise_resolved_outcome = excluded.promise_resolved_outcome,
      promise_resolved_at = case
        when defaulter_recovery_state.last_resolved_contact_id is distinct from excluded.last_resolved_contact_id
          then excluded.promise_resolved_at
        else defaulter_recovery_state.promise_resolved_at
      end,
      last_resolved_contact_id = excluded.last_resolved_contact_id,
      promise_kept_count = defaulter_recovery_state.promise_kept_count + case
        when defaulter_recovery_state.last_resolved_contact_id is distinct from excluded.last_resolved_contact_id
          and excluded.promise_resolved_outcome = 'kept'
          then 1
        else 0
      end,
      promise_broken_count = defaulter_recovery_state.promise_broken_count + case
        when defaulter_recovery_state.last_resolved_contact_id is distinct from excluded.last_resolved_contact_id
          and excluded.promise_resolved_outcome = 'broken'
          then 1
        else 0
      end
    returning 1
  )
  select count(*) into v_rows from upserted;

  return v_rows;
end;
$function$;

revoke all on function vppsone.refresh_defaulter_recovery_state(text, date) from public, anon;
grant execute on function vppsone.refresh_defaulter_recovery_state(text, date) to authenticated;
