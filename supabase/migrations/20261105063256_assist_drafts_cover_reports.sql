-- AI that shows up without being asked (D-418) and the cover period's report
-- back to the absent teacher (D-419).
--
-- assist_drafts: drafts the app prepares for one member of staff before they
-- ask: the plan for a cover duty, a class's week of notes. A draft is a
-- suggestion only; it never becomes school data until the person uses it on
-- the ordinary screen. One row per (person, kind, thing it is about), so a
-- rerun replaces rather than piles up. Expired rows are purged with the log.
--
-- cover_reports: one line from the teacher who covered a period ("settled",
-- "work done", "a problem") with an optional sentence, for the teacher who was
-- away. One report per duty; the covering teacher may change it.
--
-- Both private, like assist_log: RLS on with no policies and nothing granted to
-- anon or authenticated. The app reaches them only through the service role,
-- after its own permission and ownership checks.

create table vppsone.assist_drafts (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  kind text not null check (kind in ('cover_plan', 'class_digest')),
  ref text not null check (char_length(ref) between 1 and 120),
  session_label text not null check (session_label ~ '^([A-Z]{2,5}-)?[0-9]{4}-[0-9]{2}$'),
  title_en text not null check (char_length(title_en) between 1 and 160),
  title_hi text not null check (char_length(title_hi) between 1 and 160),
  href text check (href is null or (href ~ '^/[A-Za-z0-9/_?=&.%-]*$' and char_length(href) <= 300)),
  payload jsonb not null,
  log_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decision text check (decision in ('kept', 'edited', 'discarded')),
  decided_at timestamptz,
  constraint assist_drafts_decided check ((decision is null) = (decided_at is null)),
  constraint assist_drafts_one unique (staff_profile_id, kind, ref)
);

create index assist_drafts_waiting on vppsone.assist_drafts (staff_profile_id, expires_at) where decision is null;

create table vppsone.cover_reports (
  duty_id uuid primary key references vppsone.cover_duties (id) on delete cascade,
  session_label text not null check (session_label ~ '^([A-Z]{2,5}-)?[0-9]{4}-[0-9]{2}$'),
  written_by uuid not null references vppsone.staff_profiles (id) on delete cascade,
  outcome text not null check (outcome in ('settled', 'work_done', 'problem')),
  body text check (body is null or char_length(body) between 1 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seen_by uuid[] not null default '{}'
);

create index cover_reports_recent on vppsone.cover_reports (session_label, created_at desc);

alter table vppsone.assist_drafts enable row level security;
alter table vppsone.cover_reports enable row level security;

revoke all on vppsone.assist_drafts, vppsone.cover_reports from anon, authenticated;
grant all on vppsone.assist_drafts, vppsone.cover_reports to service_role;
