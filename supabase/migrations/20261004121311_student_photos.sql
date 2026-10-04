-- P10c: a child's photograph, placed by the office — by camera, one at a
-- time, or a whole folder matched by filename — and never silently replaced.
--
-- SamPark parity S-11: camera/file selection, retake/replace, owner mapping,
-- progress, a missing-photo view and office batch placement by filename.
-- The photograph is VPPS One's own record. The fee app's
-- `public.students.photo_path` is not read or written here (rule 2).
--
-- Bytes live in a private bucket and are served through short-lived signed
-- URLs minted after a permission check, like documents. Database backups do
-- not include Storage objects (plan §18), which is why the archive manifest
-- (P11) checksums these separately.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vppsone-photos', 'vppsone-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table vppsone.student_photos (
  id uuid primary key default gen_random_uuid(),
  -- `public.students.id`, with no foreign key (rule 2, D-5).
  student_id uuid not null,
  session_label text not null,
  storage_path text not null unique,
  content_type text not null,
  byte_size integer not null,
  sha256 text not null,
  width integer,
  height integer,
  -- 'camera' (taken on this device), 'file' (chosen one at a time),
  -- 'folder' (placed from a batch by filename, or by a person from the tray).
  source text not null,
  -- The filename it arrived as, for a folder; kept because a wrong placement
  -- is found by asking where a photograph came from.
  source_ref text,
  command_id uuid not null unique,
  uploaded_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  -- A replaced photograph is kept and says what replaced it.
  replaced_by uuid references vppsone.student_photos (id) deferrable initially deferred,
  replaced_at timestamptz,
  constraint student_photos_size check (byte_size between 1 and 2097152),
  constraint student_photos_type check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint student_photos_source check (source in ('camera', 'file', 'folder')),
  constraint student_photos_replaced_together check ((replaced_by is null) = (replaced_at is null))
);

comment on table vppsone.student_photos is
  'Photographs of children, VPPS One''s own. One current per child; a replaced one is kept with what replaced it. Bytes are in the private vppsone-photos bucket.';

create unique index student_photos_one_current
  on vppsone.student_photos (student_id) where replaced_at is null;

alter table vppsone.student_photos enable row level security;
create policy student_photos_select_scoped
  on vppsone.student_photos for select to authenticated
  using (
    (select vppsone.staff_can_any(array['collection:view', 'students:view']))
    and (
      (select vppsone.reads_every_class())
      or exists (
        select 1 from vppsone.enrolments e
        where e.student_id = student_photos.student_id
          and e.session_label = student_photos.session_label
      )
    )
  );
grant select on vppsone.student_photos to authenticated;
grant all on vppsone.student_photos to service_role;

alter table vppsone.record_commands drop constraint record_commands_kind;
alter table vppsone.record_commands add constraint record_commands_kind
  check (kind in ('accept', 'reject', 'import', 'resolve', 'photo'));

-- ---------------------------------------------------------------------------
-- Placing a photograph
-- ---------------------------------------------------------------------------

create or replace function vppsone.place_student_photo(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command uuid;
  v_actor uuid;
  v_student uuid;
  v_expected uuid;
  v_hash text := p->>'payload_hash';
  v_previous vppsone.record_commands%rowtype;
  v_current vppsone.student_photos%rowtype;
  v_id uuid;
  v_receipt jsonb;
begin
  begin
    v_command := (p->>'command_id')::uuid;
    v_actor := (p->>'actor_staff_id')::uuid;
    v_student := (p->>'student_id')::uuid;
    v_expected := nullif(p->>'expected_current', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_command is null or v_actor is null or v_student is null or v_hash is null
     or p->>'storage_path' is null or p->>'sha256' is null or p->>'session_label' is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:record-command:' || v_command::text));
  select * into v_previous from vppsone.record_commands where command_id = v_command;
  if found then
    if v_previous.payload_hash = v_hash and v_previous.actor_staff_id = v_actor then
      return v_previous.receipt || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'id_reused');
  end if;

  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and sp.is_active and rp.permission = 'collection:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  if not exists (select 1 from public.students s where s.id = v_student) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_child');
  end if;

  -- One child's photographs at a time.
  perform pg_advisory_xact_lock(hashtext('vppsone:photo:' || v_student::text));
  select * into v_current from vppsone.student_photos
  where student_id = v_student and replaced_at is null;

  -- The screen said which photograph it was replacing (or none). If that has
  -- moved — somebody else placed one meanwhile — this one is not put on top
  -- of theirs unseen.
  if v_current.id is distinct from v_expected then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'current', v_current.id);
  end if;

  -- The old photograph is marked replaced first — a unique index is checked
  -- row by row, so two current for a moment is not allowed even inside one
  -- transaction — pointing at the new one by an id minted here; the pointer
  -- is checked at commit. Nobody ever sees a child with two current or none.
  v_id := gen_random_uuid();
  if v_current.id is not null then
    update vppsone.student_photos set replaced_by = v_id, replaced_at = now()
    where id = v_current.id;
  end if;

  insert into vppsone.student_photos (
    id, student_id, session_label, storage_path, content_type, byte_size, sha256, width, height,
    source, source_ref, command_id, uploaded_by
  ) values (
    v_id, v_student, p->>'session_label', p->>'storage_path', p->>'content_type', (p->>'byte_size')::integer,
    p->>'sha256', nullif(p->>'width', '')::integer, nullif(p->>'height', '')::integer,
    p->>'source', nullif(p->>'source_ref', ''), v_command, v_actor
  );

  v_receipt := jsonb_build_object(
    'ok', true, 'command_id', v_command, 'photo_id', v_id, 'replaced', v_current.id
  );
  insert into vppsone.record_commands (command_id, kind, actor_staff_id, payload_hash, receipt)
  values (v_command, 'photo', v_actor, v_hash, v_receipt);
  return v_receipt;
end;
$$;

revoke all on function vppsone.place_student_photo(jsonb) from public, anon, authenticated;
grant execute on function vppsone.place_student_photo(jsonb) to service_role;
