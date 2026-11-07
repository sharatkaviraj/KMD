-- Synthetic stand-ins for the objects 20261107172553_certificate_requests.sql
-- reads. Nothing here is a real person; the shapes follow the vppsone schema.
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create type vppsone.staff_role as enum ('admin','office','academic_coordinator','exam_coordinator','teacher','view_only','accountant','fee_collector');
create table vppsone.staff_profiles(id uuid primary key,display_name text not null default 'Synthetic staff',short_name text,role vppsone.staff_role not null,
 is_active boolean not null default true,is_test_account boolean not null default false);
create table vppsone.role_permissions(role vppsone.staff_role not null,permission text not null,primary key(role,permission));
create function vppsone.is_test_session(p_label text) returns boolean language sql immutable set search_path='' as $$ select p_label like 'TEST-%' $$;
create function vppsone.school_today() returns date language sql stable set search_path='' as $$ select '2026-11-07'::date $$;
create table vppsone.enrolments(id uuid primary key default gen_random_uuid(),student_id uuid not null,class_id uuid not null,session_label text not null,
 status text not null default 'enrolled',left_on date,created_at timestamptz not null default now());
create table vppsone.class_teachers(staff_profile_id uuid,class_id uuid,session_label text,effective_from date,effective_to date);
create table vppsone.teaching_assignments(staff_profile_id uuid,class_id uuid,session_label text);
create table vppsone.fees_identity_students(id uuid primary key,full_name text,admission_no text,father_name text,date_of_birth date);
create table vppsone.fees_identity_classes(id uuid primary key,session_label text,class_name text,section text);
create table vppsone.school_certificate_issues(id uuid primary key default gen_random_uuid(),student_id uuid not null,session_label text not null,kind text not null,
 serial text not null,status text not null default 'prepared',artifact_state text not null default 'preparing',snapshot jsonb not null,
 issued_by uuid not null references vppsone.staff_profiles(id),storage_path text,artifact_sha256 text,supersedes uuid);
create table vppsone.school_certificate_events(id uuid primary key default gen_random_uuid(),issue_id uuid not null references vppsone.school_certificate_issues(id),
 actor_id uuid not null references vppsone.staff_profiles(id),kind text not null,reason text,command_id uuid unique,created_at timestamptz not null default now());

-- As defined in 20261101170720_school_office_certificates.sql.
create function vppsone.school_office_actor_allowed(p_actor uuid,p_permission text,p_session text default null,p_confined boolean default false)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from vppsone.staff_profiles sp
   join vppsone.role_permissions rp on rp.role=sp.role and rp.permission=p_permission
   where sp.id=p_actor and sp.is_active
   and (p_permission not like 'certificates:%' and p_permission not like 'government:%' and p_permission not like 'outcomes:%'
     or sp.role in('admin','office','academic_coordinator','exam_coordinator'))
   and (p_session is null or (
     (not p_confined or vppsone.is_test_session(p_session))
     and (vppsone.is_test_session(p_session)=coalesce(sp.is_test_account,false)
       or (sp.role='admin' and not coalesce(sp.is_test_account,false)))))
   and (p_permission<>'certificates:manage' or (not coalesce(sp.is_test_account,false) and not p_confined)));
$$;
insert into vppsone.role_permissions values('admin','certificates:issue'),('admin','certificates:view'),('office','certificates:issue'),('office','certificates:view');
