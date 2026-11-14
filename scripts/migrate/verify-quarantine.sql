-- ============================================================================
-- The quarantine checks (plan §4.6; runbook step 3; critique0 #16, #17, #20)
-- as ONE read-only SELECT on One's main database: one row per check, with the
-- number of rows that fail it. Every check must say `pass`.
--
--   psql "<session pooler>" -f scripts/migrate/verify-quarantine.sql
--   (or paste into the SQL editor; it only reads)
--
-- Run after quarantine-in-place --apply and promote-master-data --apply.
-- quarantine-in-place --rollback-only runs it inside its own transaction
-- before rolling back, so the rehearsal proves the same checks.
--
-- The bucket lists below are lib/quarantine-rules.mjs TABLES (A, R, and the
-- tables the quarantine never touches: K and C); tests/migrate-quarantine
-- .test.ts pins them equal. Every other vppsone table is bucket B: all of its
-- rows are TEST rows after the quarantine.
--
-- "Before the quarantine" below means rows created up to the last succeeded
-- quarantine-in-place run: later TEST activity by test accounts (sends to the
-- allowlist, notices) is legitimate and not checked here.
--
-- Not here: the RLS / app fence (scripts/verify-test-session-fence.sql and
-- tests/test-session-*.test.ts — a test account sees and writes only TEST),
-- and "the real 2026-27 reconcile hash is the same before and after"
-- (reconcile.mjs before step 3 and after; the quarantine never writes a
-- real public row — only TEST-D- shells and TEST twin classes).
-- ============================================================================

with
  -- @buckets-start
  a_tables(t) as (select unnest(array[
    'academic_calendar_days','attendance_rules','bell_schedules','calendar_events','class_aliases','class_seats',
    'class_teachers','collection_fields','cover_policies','exam_rooms','fee_reminder_rules','message_templates',
    'note_kinds','parent_message_policies','parent_message_switches','report_schemes','role_permissions','school_settings','staff_profiles',
    'staff_scopes','subjects','team_supervision_rules'])),
  r_tables(t) as (select unnest(array['enrolments','teaching_assignments'])),
  untouched(t) as (select unnest(array[
    'school_board_candidates','school_board_commands','school_board_cycles','school_board_readiness','school_certificate_attention','school_certificate_commands','school_certificate_events','school_certificate_issues','school_certificate_requests','school_certificate_series','school_certificate_templates','school_external_records','school_official_results','school_return_adapters','school_return_batches','school_return_copilot_rows','school_return_events',
    'assist_settings','deployment','deployment_history','fee_role_map','file_storage_settings','file_storage_settings_history',
    'fees_bridge_state','fees_bridge_sessions','fees_bridge_classes','fees_bridge_students','fees_bridge_households',
    'fees_bridge_runs','fees_bridge_retired_students','fees_bridge_retired_classes',
    'fees_bridge_routes','fees_bridge_route_sync','transport_drivers','transport_trips','transport_trip_stops',
    'class_tests','class_test_marks',
    'message_test_recipients','migration_id_map','migration_runs','migration_watermarks','one_owned_fee_settings',
    'role_permission_changes','runtime_flags','school_settings_history','staff_authority_changes','staff_notice_prefs',
    'staff_photos','staff_send_pace','staff_ui_preferences','tail_receipts_review','view_as_log',
    'ai_connections','ai_oauth_clients','ai_oauth_codes','ai_tokens','ai_tool_calls',
    'ai_jobs','builtin_ai_settings','builtin_ai_provider_status','assist_log','assist_drafts','cover_reports','data_replica','drive_folders','drive_object_copies','drive_snapshots','external_student_ids','job_runs',
    'qa_dayrun_accounts','qa_dayrun_pairs','qa_dayrun_runs','qa_dayrun_sessions','qa_runs','qa_undo','rate_limits',
    'restore_drills','sampark_import_batches','sampark_import_rows','smoke_findings','smoke_passes','smoke_pool','smoke_runs',
    'teacher_task_previews','whatsapp_inbound','whatsapp_message_events','whatsapp_messages','whatsapp_templates',
    'parent_helper_settings','parent_helper_chats','parent_helper_turns',
    'parent_helper_handoffs','parent_helper_alerts','parent_helper_deliveries','staff_whatsapp_links',
    'staff_sign_in_settings','staff_sign_in_codes','parent_absence_notes','parent_helper_lessons',
    'parent_suggestions'])),
  -- @buckets-end
  -- References with no foreign key that the catalog does not find by name
  -- (lib/quarantine-rules.mjs TABLES: staffRefs, classRefs, staffArrays,
  -- classArrays, studentArrays; the test pins this list equal to it).
  -- @refs-start
  extra_refs(t, col, kind, is_array) as (values
    ('attendance_register_revisions', 'on_behalf_of', 'staff', false),
    ('calendar_events', 'class_ids', 'class', true),
    ('cover_duties', 'absent_staff_ids', 'staff', true),
    ('cover_duties', 'class_ids', 'class', true),
    ('cover_reports', 'seen_by', 'staff', true),
    ('fee_reminder_batches', 'student_ids', 'student', true),
    ('message_campaigns', 'class_ids', 'class', true),
    ('message_sends', 'approved_by', 'staff', false),
    ('parent_route_flags', 'cleared_by', 'staff', false),
    ('record_commands', 'actor_staff_id', 'staff', false),
    ('student_documents', 'removed_by', 'staff', false),
    ('student_record_history', 'actor_staff_id', 'staff', false),
    ('substitution_assignments', 'merge_host_class_id', 'class', false),
    ('teacher_absences', 'updated_by', 'staff', false),
    ('whatsapp_messages', 'requested_by', 'staff', false),
    ('whatsapp_messages', 'retried_by', 'staff', false)),
  -- @refs-end
  quarantined_at as (
    select coalesce(
      (select max(finished_at) from vppsone.migration_runs
        where script = 'quarantine-in-place' and kind = 'run' and status = 'succeeded'),
      'infinity'::timestamptz) as at
  ),
  tabs as (
    select c.relname as t,
           bool_or(a.attname = 'session_label') as has_session,
           bool_or(a.attname = 'student_id') as has_student,
           bool_or(a.attname = 'class_id') as has_class
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relnamespace = 'vppsone'::regnamespace and c.relkind = 'r'
    group by c.relname
  ),
  -- Which rows of each table must be TEST-only: all of a B table; the
  -- TEST-labelled rows of an A or R table.
  scoped as (
    select t, has_session, has_student, has_class,
           case
             when t in (select t from untouched) then null
             when t = 'staff_profiles' then null
             when t in (select t from a_tables union all select t from r_tables) then
               case when has_session then 'vppsone.is_test_session_label(x.session_label)' end
             else 'true'
           end as scope
    from tabs
  ),
  counted as (
    -- 1. No quarantined row points at a student outside a TEST class (dev ids = live ids).
    select 'student outside TEST: ' || t as check_name,
           (xpath('/row/n/text()', query_to_xml(format(
             'select count(*) as n from vppsone.%I x left join public.students s on s.id = x.student_id
              left join public.classes c on c.id = s.class_id
              where (%s) and x.student_id is not null and not coalesce(vppsone.is_test_session_label(c.session_label), false)',
             t, scope), false, true, '')))[1]::text::int as failing
    from scoped where scope is not null and has_student
    union all
    -- 2. No quarantined row points at a real class (class_teachers: ct_mismatch).
    select case when t = 'class_teachers' then 'ct_mismatch' else 'class outside TEST: ' || t end,
           (xpath('/row/n/text()', query_to_xml(format(
             'select count(*) as n from vppsone.%I x left join public.classes c on c.id = x.class_id
              where (%s) and x.class_id is not null and not coalesce(vppsone.is_test_session_label(c.session_label), false)',
             t, scope), false, true, '')))[1]::text::int
    from scoped where scope is not null and has_class
    union all
    -- 3. Labelled with a real session: bucket A and R only.
    select 'real-session rows in a B table: ' || t,
           (xpath('/row/n/text()', query_to_xml(format(
             'select count(*) as n from vppsone.%I x where not vppsone.is_test_session_label(x.session_label)', t),
             false, true, '')))[1]::text::int
    from scoped where scope = 'true' and has_session
  ),
  staff_cols as (
    select cc.relname as t, a.attname as col, s.scope
    from pg_constraint con
    join pg_class cc on cc.oid = con.conrelid
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    join scoped s on s.t = cc.relname
    where con.contype = 'f' and con.confrelid = 'vppsone.staff_profiles'::regclass
      and cc.relnamespace = 'vppsone'::regnamespace and array_length(con.conkey, 1) = 1
      and s.scope is not null
  ),
  staff_counted as (
    -- 4. No quarantined row points at a real (non-test) staff profile (critique0 #16).
    select 'real staff on a TEST row: ' || t || '.' || col as check_name,
           (xpath('/row/n/text()', query_to_xml(format(
             'select count(*) as n from vppsone.%I x join vppsone.staff_profiles p on p.id = x.%I
              where (%s) and not p.is_test_account', t, col, scope), false, true, '')))[1]::text::int as failing
    from staff_cols
  ),
  extra_counted as (
    -- 1-2-4 again for the listed no-foreign-key references, scalar or array:
    -- no TEST row names a real class, a student outside TEST or a real profile.
    select case e.kind when 'class' then 'class outside TEST: ' when 'student' then 'student outside TEST: ' else 'real staff on a TEST row: ' end
             || e.t || '.' || e.col as check_name,
           (xpath('/row/n/text()', query_to_xml(format(
             'select count(*) as n from vppsone.%I x cross join lateral %s as u(v) where (%s) and u.v is not null and %s',
             e.t,
             case when e.is_array then format('unnest(x.%I)', e.col) else format('(select x.%I)', e.col) end,
             s.scope,
             case e.kind
               when 'class' then 'not coalesce((select vppsone.is_test_session_label(c.session_label) from public.classes c where c.id = u.v), false)'
               when 'student' then 'not coalesce((select vppsone.is_test_session_label(c.session_label) from public.students st join public.classes c on c.id = st.class_id where st.id = u.v), false)'
               else 'exists (select 1 from vppsone.staff_profiles p where p.id = u.v and not p.is_test_account)'
             end), false, true, '')))[1]::text::int as failing
    from extra_refs e join scoped s on s.t = e.t
    where s.scope is not null
  ),
  fixed as (
    -- 5. No TEST row carries a phone, destination or live token (critique0 #17).
    select 'phone on a TEST message_send' as check_name,
           (select count(*)::int from vppsone.message_sends where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and to_phone <> '') as failing
    union all select 'phone on a TEST parent_reply',
           (select count(*)::int from vppsone.parent_replies where vppsone.is_test_session_label(session_label)
              and received_at <= (select at from quarantined_at) and from_phone <> '')
    union all select 'phone on a TEST enquiry',
           (select count(*)::int from vppsone.enquiries where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and phone is not null)
    union all select 'phone on a TEST collection_request',
           (select count(*)::int from vppsone.collection_requests where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and contact_phone is not null)
    union all select 'destination on a TEST staff notice attempt',
           (select count(*)::int from vppsone.staff_notice_attempts a join vppsone.staff_notices n on n.id = a.notice_id
              where vppsone.is_test_session_label(n.session_label) and a.started_at <= (select at from quarantined_at) and a.destination <> '')
    union all select 'phone on a route flag',
           (select count(*)::int from vppsone.parent_route_flags where phone <> '' and flagged_at <= (select at from quarantined_at))
    -- Record answers to a phone / identifier / address field (critique0 #17;
    -- the pattern is lib/quarantine-rules.mjs SENSITIVE_FIELD, pinned by the test).
    union all select 'phone / identifier answer on a TEST record',
           (select count(*)::int from vppsone.student_records t
              where vppsone.is_test_session_label(t.session_label) and t.updated_at <= (select at from quarantined_at)
                and t.value is not null
                and exists (select 1 from vppsone.collection_fields f where f.id = t.field_id
                  and (f.key ~* '(phone|mobile|whatsapp|aadhaar|aadhar|apaar|email|address|contact)'
                       or coalesce(f.label_en, '') ~* '(phone|mobile|whatsapp|aadhaar|aadhar|apaar|email|address|contact)'
                       or coalesce(f.input_type::text, '') ~* 'phone|tel|email')))
    union all select 'phone / identifier answer in TEST record history',
           (select count(*)::int from vppsone.student_record_history t
              where vppsone.is_test_session_label(t.session_label) and t.recorded_at <= (select at from quarantined_at)
                and (t.old_value is not null or t.new_value is not null)
                and exists (select 1 from vppsone.collection_fields f where f.id = t.field_id
                  and (f.key ~* '(phone|mobile|whatsapp|aadhaar|aadhar|apaar|email|address|contact)'
                       or coalesce(f.label_en, '') ~* '(phone|mobile|whatsapp|aadhaar|aadhar|apaar|email|address|contact)'
                       or coalesce(f.input_type::text, '') ~* 'phone|tel|email')))
    union all select 'phone / identifier answer on a collection submission',
           (select count(*)::int from vppsone.collection_submissions t
              where t.updated_at <= (select at from quarantined_at)
                and (t.value is not null or t.previous_value is not null)
                and exists (select 1 from vppsone.collection_fields f where f.id = t.field_id
                  and (f.key ~* '(phone|mobile|whatsapp|aadhaar|aadhar|apaar|email|address|contact)'
                       or coalesce(f.label_en, '') ~* '(phone|mobile|whatsapp|aadhaar|aadhar|apaar|email|address|contact)'
                       or coalesce(f.input_type::text, '') ~* 'phone|tel|email')))
    -- 6. Terminal states: nothing quarantined can still be sent.
    union all select 'TEST message_send not cancelled (before the quarantine)',
           (select count(*)::int from vppsone.message_sends where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and (status <> 'cancelled' or sent_at is not null))
    union all select 'TEST staff notice not suppressed (before the quarantine)',
           (select count(*)::int from vppsone.staff_notices where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and status <> 'suppressed')
    union all select 'TEST parent queue row not cancelled (before the quarantine)',
           (select count(*)::int from vppsone.parent_message_queue where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and status <> 'cancelled')
    union all select 'live token on a TEST teacher task / collection request',
           (select count(*)::int from vppsone.teacher_tasks where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and token !~ '^q[0-9a-f]{31}$')
         + (select count(*)::int from vppsone.collection_requests where vppsone.is_test_session_label(session_label)
              and created_at <= (select at from quarantined_at) and token !~ '^q[0-9a-f]{31}$')
    -- 7. Shells: TEST class, no contact data.
    union all select 'TEST-D- shell outside a TEST class or with contact data',
           (select count(*)::int from public.students s join public.classes c on c.id = s.class_id
              where s.admission_no like 'TEST-D-%'
                and (not vppsone.is_test_session_label(c.session_label)
                     or coalesce(s.primary_phone, s.secondary_phone, s.guardian_phone, s.emergency_contact_phone,
                                 s.email, s.address, s.aadhaar_no, s.jan_aadhaar_no, s.apaar_id) is not null))
    union all select 'TEST-D- shell not in migration_id_map',
           (select count(*)::int from public.students s where s.admission_no like 'TEST-D-%'
              and not exists (select 1 from vppsone.migration_id_map m
                              where m.source_table = 'public.students' and m.target_id = s.id::text))
    -- 8. Logins: a QA / smoke login never acts as a real profile; a real profile has no QA login.
    union all select 'qa.vpps.local login on a real profile',
           (select count(*)::int from vppsone.staff_profiles p join auth.users u on u.id = p.user_id
              where not p.is_test_account and lower(u.email) like '%@qa.vpps.local')
    union all select 'smoke seat on a real profile',
           (select count(*)::int from vppsone.smoke_pool sp join vppsone.staff_profiles p on p.id = sp.staff_profile_id
              where not p.is_test_account)
    -- 9. The production marker and the fee-writes switch the quarantine requires.
    union all select 'marker is not production',
           (select count(*)::int from vppsone.deployment where environment <> 'production')
    union all select 'fee_writes_enabled is not false',
           case when (select value from public.app_settings where key = 'fee_writes_enabled') = 'false' then 0 else 1 end
  )
select check_name, failing, case when failing = 0 then 'pass' else 'FAIL' end as result
from (
  select * from counted
  union all select * from staff_counted
  union all select * from extra_counted
  union all select * from fixed
) checks
order by (failing = 0), check_name;
