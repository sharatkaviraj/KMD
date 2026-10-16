create schema vppsone; create schema auth;
create role anon; create role authenticated; create role service_role;
create table auth.users(id uuid primary key);
create table public.students(id uuid primary key,full_name text,house text,transport_route_id uuid,phone text);
create table vppsone.staff_profiles(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text,is_teaching boolean default false);
create table vppsone.role_permissions(role text,permission text);
create function vppsone.school_today() returns date language sql as $$select '2026-10-16'::date$$;
create table vppsone.class_teachers(id uuid default gen_random_uuid(),staff_profile_id uuid,class_id uuid,session_label text,role text,effective_from date,effective_to date);
create table vppsone.staff_scopes(staff_profile_id uuid,session_label text,kind text,value text);
create table vppsone.teaching_assignments(staff_profile_id uuid,session_label text,class_id uuid,subject_id uuid);
create table vppsone.enrolments(student_id uuid,class_id uuid,session_label text,status text,roll_no text);
create table vppsone.assessments(id uuid primary key,session_label text,status text);
create table vppsone.assessment_subjects(id uuid primary key,assessment_id uuid,class_id uuid,subject_id uuid);
create function vppsone.paper_roster(p uuid) returns setof uuid language sql as $$select e.student_id from vppsone.enrolments e join vppsone.assessment_subjects a on a.class_id=e.class_id where a.id=p and e.status='enrolled'$$;
create function vppsone.attendance_roster(s text,c uuid,d date) returns setof uuid language sql as $$select student_id from vppsone.enrolments where session_label=s and class_id=c and status='enrolled'$$;
create type vppsone.request_status as enum('draft','open','closed');
create table vppsone.collection_requests(id uuid primary key default gen_random_uuid(),session_label text,title_hi text,title_en text,class_id uuid,class_label text,assigned_staff_id uuid,token text,due_date date,status vppsone.request_status,audience_kind text,audience_label text,created_by uuid,archived_at timestamptz,created_at timestamptz default now(),token_rotated_at timestamptz);
create table vppsone.collection_fields(id uuid primary key,key text,fee_column text,is_active boolean);
create table vppsone.collection_request_fields(request_id uuid,field_id uuid,primary key(request_id,field_id));
create table vppsone.collection_request_members(request_id uuid,student_id uuid,roll_no text,snapshot jsonb,primary key(request_id,student_id));
create table vppsone.student_records(student_id uuid,field_id uuid,value text);
create table vppsone.collection_submissions(id uuid default gen_random_uuid(),request_id uuid,student_id uuid,field_id uuid,value text,previous_value text,status text,submitted_at timestamptz,decided_by uuid,unique(request_id,student_id,field_id));
create table vppsone.synthetic_writer_audit(kind text,payload jsonb);
create function vppsone.save_marks(p jsonb) returns jsonb language plpgsql as $$begin
 if p->>'synthetic_lock'='true' then return '{"ok":false,"reason":"paper_locked"}'::jsonb; end if;
 insert into vppsone.synthetic_writer_audit values('marks',p);return '{"ok":true,"revision":1}'::jsonb; end$$;
create function vppsone.save_attendance_register(p jsonb) returns jsonb language plpgsql as $$begin
 insert into vppsone.synthetic_writer_audit values('attendance',p);return '{"ok":true,"revision":1}'::jsonb; end$$;
