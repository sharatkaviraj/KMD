-- Two changes for the real year (owner, 7 Nov 2026).
--
-- 1. Teachers see their children's photos (D-511). The photos are kept in
--    Fees, and Fees shares them through One only with office staff. Janmejay
--    chose that One keeps its own copy, made when an admin taps "Refresh
--    roster now": `student_photos.source` gains 'fees' for those copies
--    (`source_ref` holds the Fees photo path the copy was made from, so a
--    changed photo is copied again). A photo a person placed in One is never
--    replaced from Fees. Nothing is written to Fees.
--
-- 2. The roster identity follows the nightly copy (D-512). D-457 (6 Nov) made
--    the Fees roster copy nightly and 20261106162701 let four readers trust a
--    roster checked within 26 hours, but `fees_identity_students` and
--    `fees_identity_classes` kept a five-minute window. Every real-year
--    command that checks the current roster through them (saving attendance,
--    saving marks, teacher tasks, Sampark rows, notices, placing a photo, and
--    the test-session fence on six tables) refused real children whenever the
--    last check was more than five minutes old, which since 6 Nov is nearly
--    always. The same 26 hours as BRIDGE_FRESH_FOR_MS. The views are patched by
--    exact text and the migration fails unless each holds the old check once.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

alter table vppsone.student_photos drop constraint student_photos_source;
alter table vppsone.student_photos add constraint student_photos_source
  check (source in ('camera', 'file', 'folder', 'fees'));
comment on column vppsone.student_photos.source is
  'camera, file or folder: placed in One by a person. fees: copied from the Fees app''s photo on an admin''s "Refresh roster now" (source_ref is the Fees photo path).';

do $$
declare
  v text;
  d text;
  old_check constant text := '''00:05:00''::interval';
  new_check constant text := '''26:00:00''::interval';
begin
  perform set_config('search_path', 'public', true);
  foreach v in array array['vppsone.fees_identity_classes', 'vppsone.fees_identity_students'] loop
    d := pg_get_viewdef(v::regclass, true);
    if (length(d) - length(replace(d, old_check, ''))) / length(old_check) <> 1 then
      raise exception 'nightly identity: % does not hold the five-minute check exactly once', v;
    end if;
    d := regexp_replace(replace(d, old_check, new_check), ';\s*$', '');
    execute format('create or replace view %s with (security_invoker = true) as %s', v, d);
    if (select reloptions from pg_class where oid = v::regclass) is distinct from array['security_invoker=true'] then
      raise exception 'nightly identity: % lost security_invoker', v;
    end if;
  end loop;
end;
$$;

commit;
