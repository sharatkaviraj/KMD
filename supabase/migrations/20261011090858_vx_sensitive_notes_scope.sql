-- Health and family notes are read by fewer people (D-264).
--
-- The 11 October improvement notes asked who sees each kind of note (§10.5).
-- The default chosen until the school answers: a support note (studies,
-- behaviour, talent, attendance) is read as before — the child's teachers,
-- the person asked to follow it up and the school-wide roles. A health or
-- family note is read by its author, the person asked to follow it up, the
-- administrator and the child's class teacher only.
--
-- `canSeeNote()` in src/vx/screens/notes/domain/notes.ts is the same rule for
-- reads made with the service role; tests/vx-notes.test.ts pins it. A note
-- written before tags existed is sensitive by its old kind (health, parent),
-- as `tagsFromKind()` reads it. Additive: one helper each, one policy body.
set local lock_timeout = '15s';

-- The classes the signed-in person is class teacher of today, as
-- "class_id|session_label" keys, the shape `my_class_keys()` returns.
create or replace function vppsone.my_held_class_keys()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ct.class_id::text || '|' || ct.session_label), '{}'::text[])
  from vppsone.class_teachers ct
  where ct.staff_profile_id = vppsone.current_staff_profile_id()
    and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
    and (ct.effective_to is null or ct.effective_to >= vppsone.school_today())
$$;
revoke all on function vppsone.my_held_class_keys() from public, anon;
grant execute on function vppsone.my_held_class_keys() to authenticated, service_role;

create or replace function vppsone.is_admin_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vppsone.staff_profiles sp
    where sp.user_id = (select auth.uid()) and sp.is_active and sp.role = 'admin'
  )
$$;
revoke all on function vppsone.is_admin_staff() from public, anon;
grant execute on function vppsone.is_admin_staff() to authenticated, service_role;

-- A note about health or family, by its tags or, with none, its old kind.
create or replace function vppsone.note_is_sensitive(p_tags text[], p_kind_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(cardinality(p_tags), 0) > 0 then p_tags && array['health', 'family']::text[]
    else exists (select 1 from vppsone.note_kinds k where k.id = p_kind_id and k.code in ('health', 'parent'))
  end
$$;
revoke all on function vppsone.note_is_sensitive(text[], uuid) from public, anon;
grant execute on function vppsone.note_is_sensitive(text[], uuid) to authenticated, service_role;

alter policy notes_select_scoped
  on vppsone.notes
  using (
    (select vppsone.staff_can('notes:view'))
    and (
      written_by = (select vppsone.current_staff_profile_id())
      or (
        visibility = 'team'
        and (
          follow_up_staff_id = (select vppsone.current_staff_profile_id())
          or (
            vppsone.note_is_sensitive(tags, kind_id)
            and (
              (select vppsone.is_admin_staff())
              or (
                class_id is not null
                and (class_id::text || '|' || session_label) = any (coalesce((select vppsone.my_held_class_keys()), '{}'::text[]))
              )
            )
          )
          or (
            not vppsone.note_is_sensitive(tags, kind_id)
            and (
              (select vppsone.staff_can('attendance:correct'))
              or (select vppsone.reads_every_class())
              or (
                class_id is not null
                and (class_id::text || '|' || session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
              )
            )
          )
        )
      )
    )
  );
