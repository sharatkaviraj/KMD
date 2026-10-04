-- teacher_absences.updated_by (added by atomic_cover_command) was a second
-- foreign key to staff_profiles. Every existing `staff_profiles!inner(...)`
-- embed on this table became ambiguous and PostgREST refused the whole select,
-- which took the cover planner down on the dev deployment for about twenty
-- minutes on 4 October. The column stays; the constraint goes — who changed an
-- absence is recorded with full integrity in teacher_absence_history.
-- The app's own embed now names its constraint as well (absences-repo.ts), so
-- neither fix depends on the other.
alter table vppsone.teacher_absences drop constraint teacher_absences_updated_by_fkey;
