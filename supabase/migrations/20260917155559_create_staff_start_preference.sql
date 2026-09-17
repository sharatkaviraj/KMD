-- Where a member of staff starts when they sign in.
--
-- The product requirement behind this column is "accounts staff should open
-- the School Fees workspace by default". The thing it must **not** become is a
-- seventh role: `accountant` is the fee app's identity model, and nothing in
-- this repo can grant it (CLAUDE.md rule 2, PLAN §3, D-6). Deriving one from
-- an email address or a menu label would be inventing access by inference.
--
-- So this is an explicit per-account preference, chosen by the person
-- themselves, and it can only ever name a destination their role already
-- reaches:
--
--   NULL              the role's own Home — the default, and what every
--                     existing row means today
--   '/students'       a VPPS One route the role holds the permission for
--   'app:schoolfees'  one of the sibling apps, and only for a role the
--                     registry already offers it to (`apps:view`)
--
-- The format is constrained here; **which** value a given role may actually
-- use is decided in `src/platform/config/start.ts`, next to the permission map
-- it has to agree with. A stored value the role no longer qualifies for is
-- ignored at read time rather than honoured — a demotion must not leave
-- somebody with a landing page they can no longer open.

alter table vppsone.staff_profiles
  add column preferred_start text;

alter table vppsone.staff_profiles
  add constraint staff_profiles_preferred_start_shape
  check (
    preferred_start is null
    or preferred_start ~ '^(/[a-z0-9/-]*|app:[a-z][a-z0-9-]*)$'
  );

comment on column vppsone.staff_profiles.preferred_start is
  'Explicit start screen for this account: NULL for the role Home, a VPPS One path, or app:<registry id>. Never grants access — resolved against the role permission map at read time.';
