-- The values the new note columns may hold.
set local lock_timeout = '15s';
alter table vppsone.notes
  add constraint notes_source_known check (source in ('typed', 'voice')),
  add constraint notes_tags_known check (tags <@ array['studies', 'behaviour', 'health', 'family', 'talent', 'attendance']::text[]),
  add constraint notes_status_known check (status in ('open', 'working', 'done')),
  add constraint notes_visibility_known check (visibility in ('team', 'private')),
  add constraint notes_follow_up_owner_known check (follow_up_owner is null or follow_up_owner in ('me', 'class_teacher', 'coordinator', 'admin')),
  add constraint notes_follow_up_has_date check (not needs_follow_up or follow_up_on is not null);
create index if not exists notes_follow_up_idx on vppsone.notes (follow_up_on) where needs_follow_up and status <> 'done';
