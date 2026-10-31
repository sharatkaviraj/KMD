-- Proof for go-live Phase F (staff WhatsApp): the queue, the claim's gate
-- facts, the hand-back, the digest fold and the triggers, against the real
-- functions on One's database, in a transaction that is rolled back.
-- Prints only counts, kinds, statuses and keys — no name, no number (rule 6).
-- Run in the SQL editor or through the Supabase MCP `execute_sql`.
begin;
create temp table proof(step text, ok boolean, detail jsonb) on commit drop;
do $$
declare
  v_student uuid; v_session text; v_req uuid; v_notice uuid; v_staff uuid; v_teacher uuid;
  v_claim jsonb; v_rel jsonb; v_count int; v_leave uuid; v_a uuid; v_b uuid;
begin
  select s.id, c.session_label into v_student, v_session
  from public.students s join public.classes c on c.id = s.class_id
  where vppsone.is_test_session_label(c.session_label) limit 1;
  insert into proof values ('A a TEST student exists', v_student is not null, null);

  -- B. A write-off request queues one money_request per admin, with a payload.
  insert into vppsone.fee_desk_requests (kind, status, session_label, student_id, amount, reason_code, requested_by_name)
  values ('write_off', 'pending', v_session, v_student, 100, 'qa', 'QA requester') returning id into v_req;
  select count(*) into v_count from vppsone.staff_notices where notice_key like 'money_request:' || v_req || ':%';
  insert into proof values ('B money_request queued to admins', v_count > 0, jsonb_build_object('notices', v_count));
  insert into proof values ('B payload keys', true, (select to_jsonb(array(select jsonb_object_keys(payload) order by 1))
    from vppsone.staff_notices where notice_key like 'money_request:' || v_req || ':%' limit 1));

  -- C. The claim returns every gate fact, and no consent is the default.
  select id, staff_profile_id into v_notice, v_staff from vppsone.staff_notices
  where notice_key like 'money_request:' || v_req || ':%' limit 1;
  update vppsone.staff_profiles set whatsapp_phone = '9000000004' where id = v_staff and vppsone.staff_destination(id) is null;
  v_claim := vppsone.claim_staff_notice('proof', 60, 'mock', v_notice);
  insert into proof values ('C claimed with gate facts',
    (v_claim->>'claimed')::boolean and (v_claim->'gate') ?& array['optInAt','optOutAt','isTestAccount','isTestSession','prefEnabled','kindsEnabled','sentToday','recentSameKind','pendingSameKind','heldForDigest','monthSent','monthCap','allowlisted'],
    jsonb_build_object('optInAt', v_claim->'gate'->'optInAt', 'monthCap', v_claim->'gate'->'monthCap',
      'money_request_on', v_claim->'gate'->'kindsEnabled'->'money_request', 'isTestSession', v_claim->'gate'->'isTestSession'));

  -- D. A defer puts it back for later and gives the attempt count back.
  v_rel := vppsone.release_staff_notice((v_claim->>'attempt_id')::uuid, 'proof', 'defer', 'outside_window', now() + interval '1 hour');
  insert into proof values ('D deferred', (select status = 'pending' and attempts = 0 and next_attempt_at > now()
    from vppsone.staff_notices where id = v_notice), v_rel - 'until');
  insert into proof values ('D not claimable while held',
    not (vppsone.claim_staff_notice('proof2', 60, 'mock', v_notice)->>'claimed')::boolean, null);

  -- E. Back in time, a second attempt is numbered past the first; a suppress ends it.
  update vppsone.staff_notices set next_attempt_at = now() - interval '1 second' where id = v_notice;
  v_claim := vppsone.claim_staff_notice('proof3', 60, 'mock', v_notice);
  insert into proof values ('E second attempt numbered 2', (v_claim->'notice'->>'attempt_no')::int = 2, null);
  perform vppsone.release_staff_notice((v_claim->>'attempt_id')::uuid, 'proof3', 'suppress', 'no_consent');
  insert into proof values ('E suppressed', (select status = 'suppressed' and status_reason = 'no_consent'
    from vppsone.staff_notices where id = v_notice), null);

  -- F. A decided request: the remaining notices are dropped at claim; the
  --    requester (none here) gets no decision notice.
  update vppsone.fee_desk_requests set status = 'declined', decided_at = now(), decision_note = 'qa' where id = v_req;
  select id into v_notice from vppsone.staff_notices
  where notice_key like 'money_request:' || v_req || ':%' and status = 'pending' limit 1;
  if v_notice is not null then
    v_claim := vppsone.claim_staff_notice('proof4', 60, 'mock', v_notice);
    insert into proof values ('F resolved before it went', (select status_reason = 'resolved'
      from vppsone.staff_notices where id = v_notice), null);
  end if;
  insert into proof values ('F no decision notice without a requester',
    not exists (select 1 from vppsone.staff_notices where notice_key = 'money_decision:' || v_req), null);

  -- G. A test account is never queued for a real session; is for TEST.
  select id into v_staff from vppsone.staff_profiles where is_test_account and is_active limit 1;
  insert into proof values ('G test account, real session: refused',
    vppsone.queue_staff_notice('proof:real', 'weekly_summary', v_staff, '2026-27', '{"summary":"x"}'::jsonb) is null, null);
  insert into proof values ('G test account, TEST session: queued',
    vppsone.queue_staff_notice('proof:test', 'weekly_summary', v_staff, v_session, '{"summary":"x"}'::jsonb) is not null, null);

  -- H. The digest folds the rest of a burst into the one being sent.
  v_a := vppsone.queue_staff_notice('proof:d1', 'weekly_summary', v_staff, v_session, '{"summary":"1"}'::jsonb);
  v_b := vppsone.queue_staff_notice('proof:d2', 'weekly_summary', v_staff, v_session, '{"summary":"2"}'::jsonb);
  update vppsone.staff_profiles set whatsapp_phone = '9000000005' where id = v_staff and vppsone.staff_destination(id) is null;
  v_claim := vppsone.claim_staff_notice('proof5', 60, 'mock', v_a);
  insert into proof values ('H burst counted', (v_claim->'gate'->>'pendingSameKind')::int >= 2, v_claim->'gate'->'pendingSameKind');
  perform vppsone.stamp_staff_notice((v_claim->>'attempt_id')::uuid, 'proof5', 'vx_staff_digest_v1', 'en', '{}'::jsonb, 'x');
  v_count := vppsone.digest_staff_notices((v_claim->>'attempt_id')::uuid, 'proof5');
  insert into proof values ('H folded into the digest', v_count >= 2 and (select status_reason = 'digested' and digest_into = v_a
    from vppsone.staff_notices where id = v_b), jsonb_build_object('folded', v_count));

  -- I. Leave asked → approvers; decided by someone else → the teacher.
  select id into v_teacher from vppsone.staff_profiles where is_test_account and is_active and id <> v_staff limit 1;
  insert into vppsone.teacher_leave (session_label, staff_profile_id, from_day, to_day, requested_by)
  values (v_session, v_teacher, current_date + 3, current_date + 3, v_teacher) returning id into v_leave;
  insert into proof values ('I leave_requested queued',
    exists (select 1 from vppsone.staff_notices where notice_key like 'leave_requested:' || v_leave || ':%'),
    jsonb_build_object('n', (select count(*) from vppsone.staff_notices where notice_key like 'leave_requested:' || v_leave || ':%')));
  insert into proof values ('I the note never in the payload', not exists (select 1 from vppsone.staff_notices
    where notice_key like 'leave_requested:' || v_leave || ':%' and payload ? 'note'), null);
  update vppsone.teacher_leave set status = 'approved', decided_by = v_staff, decided_at = now() where id = v_leave;
  insert into proof values ('I leave_decided to the teacher',
    exists (select 1 from vppsone.staff_notices where notice_key = 'leave_decided:' || v_leave and staff_profile_id = v_teacher), null);

  -- J. A kind with a payload kind cannot be written without one.
  begin
    insert into vppsone.staff_notices (notice_key, kind, staff_profile_id, session_label, day, not_after, command_id)
    values ('proof:nopayload', 'weekly_summary', v_staff, v_session, current_date, now() + interval '1 day', gen_random_uuid());
    insert into proof values ('J payload required', false, null);
  exception when check_violation then
    insert into proof values ('J payload required', true, null);
  end;
end $$;
select step, ok, detail from proof order by step;
rollback;
