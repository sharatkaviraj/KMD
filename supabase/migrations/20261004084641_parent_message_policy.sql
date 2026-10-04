-- P9: a message to a parent is approved by a person, against what is true at
-- the moment it goes — and an approval cannot go stale silently.
--
-- D-10 already held the line that matters most: the app never hands a
-- parent-facing message to a provider; a person opens it in their own
-- WhatsApp and presses send. What it did not hold: a message queued on Monday
-- could be sent on Thursday to a number the family had since changed, about a
-- request that had since been corrected, with nothing on the screen to say so;
-- and a wrong number had no way to be marked so it stopped being used.
--
-- The plan (§14): approval on by default; a bounded automatic exception names
-- its category, recipients, content, trigger, correction behaviour and policy
-- version; snapshot what was approved and recheck it at the moment it is sent;
-- a suspect route suppresses future sends, keeps the record and tells an
-- administrator; and never coalesce away a real send.

-- ---------------------------------------------------------------------------
-- The policy, per category
-- ---------------------------------------------------------------------------

create table vppsone.parent_message_policies (
  category text primary key,
  label_hi text not null,
  label_en text not null,
  /** On by default. Off only with every field of the exception filled in. */
  approval_required boolean not null default true,
  auto_recipients text,
  auto_trigger text,
  auto_content text,
  auto_correction text,
  /** Moves on every change; a message approved under an older version is stale. */
  policy_version integer not null default 1,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint parent_message_policies_exception_named check (
    approval_required
    or (
      nullif(btrim(auto_recipients), '') is not null
      and nullif(btrim(auto_trigger), '') is not null
      and nullif(btrim(auto_content), '') is not null
      and nullif(btrim(auto_correction), '') is not null
    )
  )
);

comment on table vppsone.parent_message_policies is
  'Whether a person must approve each parent message of a category (the default), or the bounded automatic exception the school named instead. Staff-cover automation authorises nothing here.';

insert into vppsone.parent_message_policies (category, label_hi, label_en) values
  ('collection_request', 'जानकारी/दस्तावेज़ माँगना', 'Asking for details or documents'),
  ('report_delivery', 'रिपोर्ट भेजना', 'Sending a report card'),
  ('absence_notice', 'अनुपस्थिति की सूचना', 'Absence notice'),
  ('general', 'अन्य', 'Anything else');

alter table vppsone.parent_message_policies enable row level security;
create policy parent_message_policies_select_staff
  on vppsone.parent_message_policies for select to authenticated
  using ((select vppsone.is_active_staff()));
grant select on vppsone.parent_message_policies to authenticated;
grant all on vppsone.parent_message_policies to service_role;

-- ---------------------------------------------------------------------------
-- What was approved, and whether it still holds
-- ---------------------------------------------------------------------------

alter table vppsone.message_sends
  add column category text not null default 'general',
  -- No foreign key: message_sends already points at staff_profiles twice, and
  -- a third would be one more relationship every embed has to name.
  add column approved_by uuid,
  add column approved_at timestamptz,
  /** {destination, contact, record, content, policy_version} as they were when queued. */
  add column snapshot jsonb,
  add column stale_at timestamptz,
  add column stale_reason text;

comment on column vppsone.message_sends.snapshot is
  'For a parent message: the destination, the guardian contact on record, the record it is about, a hash of the text and the policy version, as they were when it was queued. Rechecked when it is approved and when it is marked sent.';

-- ---------------------------------------------------------------------------
-- A route somebody has reported as wrong
-- ---------------------------------------------------------------------------

create table vppsone.parent_route_flags (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  student_id uuid,
  reason text not null,
  flagged_by uuid references vppsone.staff_profiles (id) on delete restrict,
  flagged_at timestamptz not null default now(),
  cleared_by uuid,
  cleared_at timestamptz,
  clear_note text,
  constraint parent_route_flags_reason_says check (btrim(reason) <> ''),
  constraint parent_route_flags_cleared_together check ((cleared_at is null) = (cleared_by is null))
);

comment on table vppsone.parent_route_flags is
  'A parent number somebody said is wrong. While a flag is open nothing is sent to it; clearing one is an administrator''s, with a note. Kept, never deleted.';

create index parent_route_flags_open_idx on vppsone.parent_route_flags (phone) where cleared_at is null;

alter table vppsone.parent_route_flags enable row level security;
create policy parent_route_flags_select_collection
  on vppsone.parent_route_flags for select to authenticated
  using ((select vppsone.staff_can('collection:view')));
grant select on vppsone.parent_route_flags to authenticated;
grant all on vppsone.parent_route_flags to service_role;

-- The switch already exists: `runtime_flags.parent_dispatch`, off. The app
-- hands a parent message to a provider only when it is on *and* the
-- message's category names an automatic exception *and* nothing about the
-- message has gone stale — the rule lives in `mayDispatch()`.
