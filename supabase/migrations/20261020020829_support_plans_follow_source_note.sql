-- R01 (19 Oct assessment brief), defence in depth. The app reads support
-- plans with the service role and checks the source note itself (D-302);
-- this policy holds a direct REST read to the same line: a school-wide reader
-- sees a plan only when it has no source note or she can read that note
-- (the subquery runs under notes_select_scoped, so an Only me note, or a
-- health or family note she may not read, keeps its plan from her). The
-- maker always reads her plan; steps follow their plan's visibility.
-- Rollback: alter the policy back to the using clause in
-- 20261010102943_vx_academics_calendar.sql.

alter policy support_plans_select_scoped on vppsone.support_plans
  using (
    (select vppsone.staff_can('notes:view'))
    and (
      created_by = (select vppsone.current_staff_profile_id())
      or (
        (select vppsone.reads_every_class())
        and (note_id is null or exists (select 1 from vppsone.notes n where n.id = support_plans.note_id))
      )
    )
  );
