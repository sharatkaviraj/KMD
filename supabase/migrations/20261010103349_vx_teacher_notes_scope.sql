-- "Only me" is only the author. Team notes are read by the office and admin
-- (who correct attendance), the coordinators (who read every class), the
-- person asked to follow up, and the teachers of that class — so a subject
-- teacher's note reaches the class teacher by itself.
set local lock_timeout = '15s';
alter policy notes_select_scoped
  on vppsone.notes
  using (
    (select vppsone.staff_can('notes:view'))
    and (
      written_by = (select vppsone.current_staff_profile_id())
      or (
        visibility = 'team'
        and (
          (select vppsone.staff_can('attendance:correct'))
          or (select vppsone.reads_every_class())
          or follow_up_staff_id = (select vppsone.current_staff_profile_id())
          or (
            class_id is not null
            and (class_id::text || '|' || session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
          )
        )
      )
    )
  );
