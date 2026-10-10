-- VPPS One — notes on children get the design's shape (UI P7): tags,
-- voice/typed, a follow-up with a date and an owner, a status
-- (open → working → done), visibility (team / only me) and "tell parents".
-- Additive, vppsone only.
set local lock_timeout = '15s';
alter table vppsone.notes
  add column if not exists source text not null default 'typed',
  add column if not exists tags text[] not null default '{}',
  add column if not exists needs_follow_up boolean not null default false,
  add column if not exists follow_up_on date,
  add column if not exists follow_up_owner text,
  add column if not exists follow_up_staff_id uuid references vppsone.staff_profiles (id) on delete set null,
  add column if not exists status text not null default 'open',
  add column if not exists visibility text not null default 'team',
  add column if not exists tell_parents boolean not null default false,
  add column if not exists author_relation text,
  add column if not exists subject_code text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references vppsone.staff_profiles (id) on delete set null;
