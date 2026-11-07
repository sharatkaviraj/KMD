-- Minimal prior-migration objects for the real delivery migration, no production data.
alter table vppsone.staff_profiles add phone text, add whatsapp_phone text, add updated_at timestamptz default now(), add preferred_language text default 'both';
alter table vppsone.collection_fields add label_hi text default 'Synthetic field', add label_en text default 'Synthetic field';
create table public.classes(id uuid primary key,class_name text,section text,stream_name text);
create table vppsone.subjects(id uuid primary key,name_hi text,name_en text);
alter table vppsone.collection_requests add opened_at timestamptz;
alter table vppsone.assessment_subjects add entry_status text default 'draft';
create table vppsone.attendance_registers(id uuid primary key,session_label text,class_id uuid,day date,period int,revision int);
create type vppsone.send_status as enum('draft','queued','sent','failed','cancelled');
create table vppsone.message_templates(id uuid primary key default gen_random_uuid(),code text unique,label_hi text,label_en text,body_hi text,body_en text,variables text[],has_url_button boolean,audience text,is_active boolean default true,sort_order int default 0);
create table vppsone.message_sends(id uuid primary key default gen_random_uuid(),session_label text not null,template_id uuid not null references vppsone.message_templates(id),to_phone text not null,to_name text,student_id uuid,request_id uuid references vppsone.collection_requests(id),staff_profile_id uuid references vppsone.staff_profiles(id),variables text[],rendered_hi text not null,rendered_en text not null,status vppsone.send_status not null default 'draft',provider_message_id text,error text,requested_by uuid references vppsone.staff_profiles(id),requested_at timestamptz default now(),sent_at timestamptz,updated_at timestamptz default now(),check((status='sent')=(sent_at is not null)));
-- The columns 20261004084641_parent_message_policy.sql added before task delivery
-- existed. Live has them, so the delivery functions must meet them here too:
-- a bare `snapshot` that is both a variable and this column stopped every queue.
alter table vppsone.message_sends add column category text not null default 'general',add column approved_by uuid,add column approved_at timestamptz,add column snapshot jsonb,add column stale_at timestamptz,add column stale_reason text;
alter table vppsone.message_sends enable row level security;
create policy message_sends_select_authenticated on vppsone.message_sends for select to authenticated using(true);
grant usage on schema vppsone to authenticated,service_role;
grant select on vppsone.message_sends to authenticated;
