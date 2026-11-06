-- Bolo can be typed as well as spoken (teacher day, 6 Nov 2026: "You can't
-- type to Bolo"). A typed request is one UTF-8 text file in the same private
-- bucket, on the same voice job, quota, review and 90-day purge as a recording.
-- The server writes it; no browser uploads text.
begin;

update storage.buckets
set allowed_mime_types = array['image/jpeg','audio/webm','audio/mp4','audio/wav','audio/m4a','text/plain']
where id = 'ai-inputs' and public is false;

create or replace function vppsone.reserve_ai_job(
  p_staff uuid, p_action text, p_session text, p_target uuid, p_revision integer,
  p_pages integer, p_model text, p_audio_extension text default null
) returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_day timestamptz := date_trunc('day', v_now at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_limit integer;
  v_extension text := coalesce(p_audio_extension, 'jpg');
  v_test boolean;
begin
  if p_action not in ('marks-photo','substitution-photo','voice')
     or p_pages is null or p_pages not between 1 and 4
     or (p_action = 'voice' and (p_pages <> 1 or v_extension not in ('webm','m4a','wav','txt')))
     or (p_action <> 'voice' and p_audio_extension is not null)
     or p_action is null
     or p_session is null or p_session !~ '^([A-Z]{2,5}-)?[0-9]{4}-[0-9]{2}$' then
    raise exception 'invalid AI input';
  end if;
  select is_test_account into v_test from vppsone.staff_profiles where id = p_staff and is_active;
  if not found then
    raise exception 'invalid AI input';
  end if;
  -- A test account works only in a TEST session (D-340). Which real session a
  -- member of staff may open is the app's session rule (resolveSessionLabel).
  if v_test and p_session !~ '^(TEST|UAT|DEMO)-[0-9]{4}-[0-9]{2}$' then
    raise exception 'AI session not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('builtin-ai:' || p_staff::text, 0));
  select daily_limit into v_limit from vppsone.builtin_ai_settings where id = 1;
  if v_limit is null or (select count(*) from vppsone.ai_jobs where staff_profile_id = p_staff and created_at >= v_day) >= v_limit then
    return null;
  end if;
  insert into vppsone.ai_jobs (id, staff_profile_id, action, session_label, target_id, target_revision, input_paths, model, created_at)
  values (v_id, p_staff, p_action, p_session, p_target, p_revision,
    array(select v_id::text || '/' || i::text || '.' || v_extension from generate_series(1, p_pages) i), p_model, v_now);
  return v_id;
end;
$$;
revoke all on function vppsone.reserve_ai_job(uuid, text, text, uuid, integer, integer, text, text) from public, anon, authenticated;
grant execute on function vppsone.reserve_ai_job(uuid, text, text, uuid, integer, integer, text, text) to service_role;

commit;
