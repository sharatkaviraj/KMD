-- P10 part 1 of the redesign (docs/design-handoff): Timetable, Messages,
-- Staff & roles, Settings. Additive only; every object in `vppsone`.
--
--  1. The role matrix becomes editable. `vppsone.role_permissions` stays the
--     one map the policies read (`staff_can`), and now the app reads it too
--     (`my_permissions`). Edits go through `set_role_permissions`, which
--     re-reads the actor, refuses anyone but an active administrator, keeps
--     the Admin column locked, never gives a teacher money, and appends every
--     change to `role_permission_changes`.
--  2. School-wide settings (profile, receipt footer) and each person's own
--     alert preferences, with an insert-only history of every settings change.
--  3. Timetable: edits waiting to be published, and teacher leave requests.
--  4. Messages: a notice sent to many people is a campaign; each recipient is
--     still one `message_sends` row (now carrying `campaign_id`). Parent
--     replies are their own inbox. Templates gain their WhatsApp category.

-- ------------------------------------------------------------- 1. role matrix

create table vppsone.role_permission_changes (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid not null references vppsone.staff_profiles(id) on delete restrict,
  role vppsone.staff_role not null,
  permission text not null,
  granted boolean not null,
  reason text,
  changed_at timestamptz not null default now()
);

comment on table vppsone.role_permission_changes is
  'Every change to the role matrix: who, which role, which permission, on or off. Appended by set_role_permissions(); never edited.';

alter table vppsone.role_permission_changes enable row level security;
revoke all on vppsone.role_permission_changes from anon, authenticated;
grant select, insert on vppsone.role_permission_changes to service_role;

create or replace function vppsone.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}'::text[])
  from vppsone.staff_profiles sp
  join vppsone.role_permissions rp on rp.role = sp.role
  where sp.user_id = (select auth.uid()) and sp.is_active
$$;

comment on function vppsone.my_permissions() is
  'The signed-in staff member''s permissions as the matrix holds them now, so can() honours an admin''s edit on the next request.';

revoke all on function vppsone.my_permissions() from public, anon;
grant execute on function vppsone.my_permissions() to authenticated, service_role;

create or replace function vppsone.set_role_permissions(
  p_actor_staff_id uuid,
  p_changes jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor vppsone.staff_profiles%rowtype;
  change jsonb;
  v_role vppsone.staff_role;
  v_permission text;
  v_granted boolean;
  v_rows integer;
  v_applied integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('vppsone:role-matrix'));

  select * into actor from vppsone.staff_profiles where id = p_actor_staff_id;
  if not found or not actor.is_active or actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  -- Every change is checked before any is applied: all or nothing.
  for change in select value from jsonb_array_elements(p_changes) loop
    if not (change->>'role') = any (enum_range(null::vppsone.staff_role)::text[]) then
      return jsonb_build_object('ok', false, 'reason', 'bad_role');
    end if;
    v_role := (change->>'role')::vppsone.staff_role;
    v_permission := change->>'permission';
    v_granted := (change->>'granted')::boolean;
    if v_granted is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_request');
    end if;
    if v_role = 'admin' then
      return jsonb_build_object('ok', false, 'reason', 'admin_locked');
    end if;
    -- Only a permission the app knows: the Admin column holds every one.
    if not exists (
      select 1 from vppsone.role_permissions
      where role = 'admin' and permission = v_permission
    ) then
      return jsonb_build_object('ok', false, 'reason', 'unknown_permission');
    end if;
    if v_role = 'teacher' and v_granted and v_permission like 'fees:%' then
      return jsonb_build_object('ok', false, 'reason', 'teacher_money');
    end if;
  end loop;

  for change in select value from jsonb_array_elements(p_changes) loop
    v_role := (change->>'role')::vppsone.staff_role;
    v_permission := change->>'permission';
    v_granted := (change->>'granted')::boolean;

    if v_granted then
      insert into vppsone.role_permissions (role, permission)
      values (v_role, v_permission)
      on conflict do nothing;
    else
      delete from vppsone.role_permissions
      where role = v_role and permission = v_permission;
    end if;
    get diagnostics v_rows = row_count;

    if v_rows > 0 then
      insert into vppsone.role_permission_changes (actor_staff_id, role, permission, granted, reason)
      values (actor.id, v_role, v_permission, v_granted, nullif(btrim(coalesce(p_reason, '')), ''));
      v_applied := v_applied + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'applied', v_applied);
end;
$$;

comment on function vppsone.set_role_permissions(uuid, jsonb, text) is
  'The only writer of role_permissions after the seed. Admin only (re-read now), Admin column locked, no money for teachers, every change logged.';

revoke all on function vppsone.set_role_permissions(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function vppsone.set_role_permissions(uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------- 2. settings

create table vppsone.school_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references vppsone.staff_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint school_settings_key_shape check (key ~ '^[a-z_]+$')
);

comment on table vppsone.school_settings is
  'School-wide settings the admin edits on Settings (profile, receipt footer). One row per key; every change is in school_settings_history.';

create table vppsone.school_settings_history (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  before jsonb,
  after jsonb not null,
  changed_by uuid references vppsone.staff_profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

comment on table vppsone.school_settings_history is 'Every settings change, before and after. Insert-only.';

create table vppsone.staff_ui_preferences (
  staff_profile_id uuid primary key references vppsone.staff_profiles(id) on delete cascade,
  large_text boolean not null default false,
  alerts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table vppsone.staff_ui_preferences is
  'One person''s own preferences beyond language: large text, and which WhatsApp alerts reach their phone.';

alter table vppsone.school_settings enable row level security;
alter table vppsone.school_settings_history enable row level security;
alter table vppsone.staff_ui_preferences enable row level security;
revoke all on vppsone.school_settings, vppsone.school_settings_history, vppsone.staff_ui_preferences from anon, authenticated;
grant all on vppsone.school_settings, vppsone.staff_ui_preferences to service_role;
grant select, insert on vppsone.school_settings_history to service_role;

-- --------------------------------------------------------------- 3. timetable

create table vppsone.timetable_changes (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  base_version_id uuid not null references vppsone.timetable_versions(id) on delete restrict,
  day text not null,
  period smallint not null check (period between 0 and 15),
  class_id uuid not null,
  class_label text not null,
  from_subject_code text,
  from_teacher_short_name text,
  subject_id uuid not null references vppsone.subjects(id) on delete restrict,
  subject_code text not null,
  staff_profile_id uuid not null references vppsone.staff_profiles(id) on delete restrict,
  teacher_short_name text not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'discarded')),
  published_version_id uuid references vppsone.timetable_versions(id) on delete set null,
  created_by uuid not null references vppsone.staff_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  decided_by uuid references vppsone.staff_profiles(id) on delete set null,
  decided_at timestamptz
);

comment on table vppsone.timetable_changes is
  'A period changed on the timetable screen and not yet published. Publishing copies the live version, applies every pending change and publishes the copy; teachers see nothing until then.';

create unique index timetable_changes_one_pending_per_cell
  on vppsone.timetable_changes (session_label, day, period, class_id)
  where status = 'pending';

create table vppsone.teacher_leave (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  staff_profile_id uuid not null references vppsone.staff_profiles(id) on delete restrict,
  from_day date not null,
  to_day date not null,
  span text not null default 'full' check (span in ('full', 'first_half', 'second_half')),
  note text,
  status text not null default 'asked' check (status in ('asked', 'approved', 'declined', 'cancelled')),
  requested_by uuid not null references vppsone.staff_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  decided_by uuid references vppsone.staff_profiles(id) on delete set null,
  decided_at timestamptz,
  constraint teacher_leave_order check (to_day >= from_day),
  constraint teacher_leave_short check (to_day - from_day <= 60)
);

comment on table vppsone.teacher_leave is
  'Leave asked for or recorded. Approving turns each school day into a teacher absence through the cover command, so cover is arranged and notices are queued the usual way. The note is never put in a notice.';

alter table vppsone.timetable_changes enable row level security;
alter table vppsone.teacher_leave enable row level security;
revoke all on vppsone.timetable_changes, vppsone.teacher_leave from anon, authenticated;
grant all on vppsone.timetable_changes, vppsone.teacher_leave to service_role;

-- ---------------------------------------------------------------- 4. messages

create table vppsone.message_campaigns (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  kind text not null check (kind in ('notice', 'holiday', 'ptm', 'fee', 'result', 'staff')),
  title text not null check (length(btrim(title)) between 1 and 120),
  body_hi text,
  body_en text,
  language text not null default 'both' check (language in ('both', 'hi', 'en')),
  audience text not null check (audience in ('school', 'classes', 'staff')),
  class_ids uuid[] not null default '{}',
  audience_label text not null,
  recipient_count integer not null check (recipient_count >= 0),
  cost_paise integer not null check (cost_paise >= 0),
  status text not null default 'queued' check (status in ('queued', 'cancelled')),
  client_request_id uuid not null unique,
  created_by uuid not null references vppsone.staff_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  cancelled_by uuid references vppsone.staff_profiles(id) on delete set null,
  cancelled_at timestamptz,
  constraint message_campaigns_has_text check (coalesce(body_hi, '') <> '' or coalesce(body_en, '') <> '')
);

comment on table vppsone.message_campaigns is
  'One notice to many people. Each recipient is a message_sends row with this campaign_id. Parent rows stop at queued: a person sends them (D-10).';

alter table vppsone.message_sends
  add column if not exists campaign_id uuid references vppsone.message_campaigns(id) on delete restrict;

create index if not exists message_sends_campaign_idx on vppsone.message_sends (campaign_id) where campaign_id is not null;

alter table vppsone.message_templates
  add column if not exists wa_category text check (wa_category in ('utility', 'marketing'));

create table vppsone.parent_replies (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  from_name text not null,
  from_phone text not null,
  student_id uuid,
  student_label text,
  campaign_id uuid references vppsone.message_campaigns(id) on delete set null,
  regarding text,
  body text not null,
  received_at timestamptz not null default now(),
  assigned_staff_id uuid references vppsone.staff_profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done')),
  done_by uuid references vppsone.staff_profiles(id) on delete set null,
  done_at timestamptz
);

comment on table vppsone.parent_replies is
  'A parent''s WhatsApp reply to a notice. An answer is queued as a message_sends row for a person to send; nothing here sends.';

create table vppsone.parent_reply_answers (
  id uuid primary key default gen_random_uuid(),
  reply_id uuid not null references vppsone.parent_replies(id) on delete restrict,
  body text not null,
  message_send_id uuid references vppsone.message_sends(id) on delete set null,
  answered_by uuid not null references vppsone.staff_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table vppsone.parent_reply_answers is 'What the school answered to a parent reply. Insert-only.';

alter table vppsone.message_campaigns enable row level security;
alter table vppsone.parent_replies enable row level security;
alter table vppsone.parent_reply_answers enable row level security;
revoke all on vppsone.message_campaigns, vppsone.parent_replies, vppsone.parent_reply_answers from anon, authenticated;
grant all on vppsone.message_campaigns, vppsone.parent_replies to service_role;
grant select, insert on vppsone.parent_reply_answers to service_role;

-- The two templates a notice is queued under: one for families, one for staff.
insert into vppsone.message_templates (code, label_hi, label_en, body_hi, body_en, variables, has_url_button, audience, is_active, sort_order, wa_category)
values
  ('vx_school_notice', 'स्कूल सूचना', 'School notice', '{{1}}', '{{1}}', array['text'], false, 'parent', true, 900, 'utility'),
  ('vx_staff_notice', 'स्टाफ़ सूचना', 'Staff notice', '{{1}}', '{{1}}', array['text'], false, 'staff', true, 901, 'utility')
on conflict (code) do nothing;
