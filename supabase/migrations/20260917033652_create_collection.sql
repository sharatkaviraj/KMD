-- VPPS One — collection: the Sampark merge (Phase 5).
--
-- Asking the school a question and getting an answer back, without anybody
-- signing in. The office builds a request, sends one link per teacher, and the
-- answers arrive here for a person to accept.

create type vppsone.field_input as enum
  ('text', 'tel', 'number', 'date', 'boolean', 'select');

-- `confirm` shows what is on record and asks whether it is right; `collect`
-- shows an empty input. The difference matters on a phone: confirming forty
-- numbers is forty taps, typing them is forty minutes.
create type vppsone.field_mode as enum ('confirm', 'collect');

create type vppsone.request_status as enum ('draft', 'open', 'closed');
create type vppsone.submission_status as enum ('pending', 'accepted', 'rejected');
create type vppsone.record_source as enum ('teacher', 'office', 'import');
create type vppsone.send_status as enum ('draft', 'queued', 'sent', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- collection_fields — the registry
-- ---------------------------------------------------------------------------
--
-- One row per question the school can ask. The key is a database identifier:
-- submissions and student records point at it, and it is never renamed once
-- anything does.

create table vppsone.collection_fields (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  label_hi text not null,
  label_en text not null,

  input_type vppsone.field_input not null default 'text',
  mode vppsone.field_mode not null default 'confirm',

  -- Validation, carried on the row so the same rules run in the browser and on
  -- the server. A nine-digit phone number must be impossible to *submit*, not
  -- something the office cleans up later.
  exact_len smallint,
  pattern text,
  max_value numeric,
  options text[],

  -- Which fee-app column answers the same question, when one does.
  --
  -- Sampark wrote these straight back to its own `students` table. Rule 2
  -- forbids that here: `public` is the fee app's and VPPS One never writes it.
  -- So this is not a destination, it is a **comparison**: it lets a request
  -- show the teacher what the fee app currently holds, and lets the review
  -- queue say "the fee app says one thing, the teacher says another" — which a
  -- person then fixes in the fee app, deliberately.
  fee_column text,

  help_hi text,
  help_en text,

  is_active boolean not null default true,
  sort_order integer not null default 0,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The rule the key editor enforces, held by the database as well, because a
  -- key is a foreign key in everything but name.
  constraint collection_fields_key_shape check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint collection_fields_exact_len_sane check (exact_len is null or exact_len between 1 and 200)
);

comment on table vppsone.collection_fields is
  'Every question the school can ask. The key is referenced by submissions and student records and is never renamed.';

create unique index collection_fields_key_unique on vppsone.collection_fields (key);
create index collection_fields_active_idx on vppsone.collection_fields (is_active, sort_order);

create trigger collection_fields_set_updated_at
  before update on vppsone.collection_fields
  for each row execute function vppsone.set_updated_at();

alter table vppsone.collection_fields enable row level security;
create policy collection_fields_select_authenticated
  on vppsone.collection_fields for select to authenticated using (true);
grant select on vppsone.collection_fields to authenticated;
grant all on vppsone.collection_fields to service_role;


-- ---------------------------------------------------------------------------
-- collection_requests — one ask, one audience, one link
-- ---------------------------------------------------------------------------

create table vppsone.collection_requests (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  title_hi text not null,
  title_en text not null,

  -- The class whose roll is being asked about. No FK (rule 2, D-5).
  class_id uuid not null,
  class_label text not null,

  -- Who the link was made for. Null when the office keeps it themselves.
  assigned_staff_id uuid references vppsone.staff_profiles (id) on delete set null,

  -- ~96 bits of entropy. Enumeration is infeasible on its own, and the rate
  -- limit below makes guessing cost something as well.
  token text not null,

  due_date date,
  status vppsone.request_status not null default 'draft',

  -- The office's own sentence about why this link shows nine children rather
  -- than a whole class. Without it a subset reads as a broken list.
  reason_hi text,
  reason_en text,

  opened_at timestamptz,
  closed_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collection_requests_token_shape check (char_length(token) between 12 and 64)
);

comment on table vppsone.collection_requests is
  'One request: a class, a set of fields, a due date and a token. The token is the whole authorization — see resolveToken().';

create unique index collection_requests_token_unique on vppsone.collection_requests (token);
create index collection_requests_open_idx
  on vppsone.collection_requests (session_label, status, due_date);
create index collection_requests_staff_idx
  on vppsone.collection_requests (assigned_staff_id, status);

create trigger collection_requests_set_updated_at
  before update on vppsone.collection_requests
  for each row execute function vppsone.set_updated_at();

alter table vppsone.collection_requests enable row level security;
create policy collection_requests_select_authenticated
  on vppsone.collection_requests for select to authenticated using (true);
grant select on vppsone.collection_requests to authenticated;
grant all on vppsone.collection_requests to service_role;


-- ---------------------------------------------------------------------------
-- collection_request_fields — what this request asks for
-- ---------------------------------------------------------------------------

create table vppsone.collection_request_fields (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null
    references vppsone.collection_requests (id) on delete cascade,
  field_id uuid not null
    references vppsone.collection_fields (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index collection_request_fields_unique
  on vppsone.collection_request_fields (request_id, field_id);

alter table vppsone.collection_request_fields enable row level security;
create policy collection_request_fields_select_authenticated
  on vppsone.collection_request_fields for select to authenticated using (true);
grant select on vppsone.collection_request_fields to authenticated;
grant all on vppsone.collection_request_fields to service_role;


-- ---------------------------------------------------------------------------
-- collection_submissions — what came back
-- ---------------------------------------------------------------------------
--
-- One row per (request, student, field). Re-answering replaces rather than
-- appends: a teacher who corrects a typo is fixing her answer, not filing a
-- second one, and an office reading a queue of both would have to work out
-- which is current.

create table vppsone.collection_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null
    references vppsone.collection_requests (id) on delete cascade,

  -- `public.students.id`, with no FK (rule 2, D-5).
  student_id uuid not null,
  field_id uuid not null
    references vppsone.collection_fields (id) on delete restrict,

  -- Already normalised by the time it lands: ten digits for a phone, yes/no
  -- for a boolean, an ISO date for a date.
  value text,

  -- What the school held when the link was sent, frozen. The review queue
  -- shows the two side by side, and "no change" is a real answer.
  previous_value text,

  status vppsone.submission_status not null default 'pending',

  submitted_at timestamptz not null default now(),
  decided_by uuid references vppsone.staff_profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint collection_submissions_decided_together
    check (
      (status = 'pending' and decided_at is null)
      or (status <> 'pending' and decided_at is not null)
    )
);

comment on table vppsone.collection_submissions is
  'One answer per (request, student, field). Re-answering replaces: a correction is not a second submission.';

create unique index collection_submissions_unique
  on vppsone.collection_submissions (request_id, student_id, field_id);

create index collection_submissions_pending_idx
  on vppsone.collection_submissions (status, submitted_at desc);

create index collection_submissions_student_idx
  on vppsone.collection_submissions (student_id);

create trigger collection_submissions_set_updated_at
  before update on vppsone.collection_submissions
  for each row execute function vppsone.set_updated_at();

alter table vppsone.collection_submissions enable row level security;
create policy collection_submissions_select_authenticated
  on vppsone.collection_submissions for select to authenticated using (true);
grant select on vppsone.collection_submissions to authenticated;
grant all on vppsone.collection_submissions to service_role;


-- ---------------------------------------------------------------------------
-- student_records — what the school now holds
-- ---------------------------------------------------------------------------
--
-- The accepted answer, one per (student, field). This is VPPS One's own record
-- and it never overwrites the fee app: where a field names a `fee_column`, the
-- two are shown side by side and a person decides.
--
-- **An accepted teacher answer outranks every import, forever.** That is
-- written in code rather than as an editable row on purpose — a row can be
-- changed, and no administrative convenience is worth the day a teacher finds
-- her approved correction was quietly undone by somebody re-importing last
-- term's export.

create table vppsone.student_records (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  student_id uuid not null,
  field_id uuid not null
    references vppsone.collection_fields (id) on delete restrict,

  value text,
  source vppsone.record_source not null default 'teacher',

  source_submission_id uuid
    references vppsone.collection_submissions (id) on delete set null,

  recorded_by uuid references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vppsone.student_records is
  'The accepted value per (student, field). VPPS One''s own record; it never writes the fee app.';

create unique index student_records_unique
  on vppsone.student_records (student_id, field_id);

create index student_records_field_idx on vppsone.student_records (field_id);

create trigger student_records_set_updated_at
  before update on vppsone.student_records
  for each row execute function vppsone.set_updated_at();

alter table vppsone.student_records enable row level security;
create policy student_records_select_authenticated
  on vppsone.student_records for select to authenticated using (true);
grant select on vppsone.student_records to authenticated;
grant all on vppsone.student_records to service_role;


-- ---------------------------------------------------------------------------
-- student_documents
-- ---------------------------------------------------------------------------
--
-- The file itself lives in Supabase Storage; this is the row that says whose
-- it is and what it is. The bucket is private, and a document is served
-- through a signed URL minted after a permission check — never by a public
-- path, because a birth certificate with a guessable URL is a birth
-- certificate anybody has.

create table vppsone.student_documents (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  student_id uuid not null,

  kind text not null default 'other',
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  byte_size integer not null,

  note text,

  uploaded_by uuid references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint student_documents_size_sane check (byte_size between 1 and 20000000)
);

comment on table vppsone.student_documents is
  'A file about one child, held in a private Storage bucket and served through a signed URL after a permission check.';

create unique index student_documents_path_unique
  on vppsone.student_documents (storage_path);

create index student_documents_student_idx
  on vppsone.student_documents (student_id, created_at desc);

create trigger student_documents_set_updated_at
  before update on vppsone.student_documents
  for each row execute function vppsone.set_updated_at();

alter table vppsone.student_documents enable row level security;
create policy student_documents_select_authenticated
  on vppsone.student_documents for select to authenticated using (true);
grant select on vppsone.student_documents to authenticated;
grant all on vppsone.student_documents to service_role;


-- ---------------------------------------------------------------------------
-- message_templates and message_sends
-- ---------------------------------------------------------------------------
--
-- A WhatsApp template is approved by Meta with its wording fixed; the app may
-- only fill the numbered placeholders. So the wording lives here, beside the
-- name AiSensy knows it by, and a send records which template and which
-- values — enough to explain, a year later, exactly what a parent received.

create table vppsone.message_templates (
  id uuid primary key default gen_random_uuid(),

  -- The AiSensy campaign name. This is the contract with the provider.
  code text not null,

  label_hi text not null,
  label_en text not null,

  -- The approved wording, with {{1}}, {{2}} … where values go.
  body_hi text not null,
  body_en text not null,

  -- What each placeholder means, in order, so a send screen can label the
  -- boxes instead of asking somebody to remember.
  variables text[] not null default '{}',

  -- Whether the template carries a URL button, which is how a token link
  -- reaches a teacher's phone.
  has_url_button boolean not null default false,

  audience text not null default 'staff',

  is_active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint message_templates_audience_known check (audience in ('staff', 'parent'))
);

comment on table vppsone.message_templates is
  'The approved wording of each WhatsApp template, beside the name AiSensy knows it by.';

create unique index message_templates_code_unique on vppsone.message_templates (code);

create trigger message_templates_set_updated_at
  before update on vppsone.message_templates
  for each row execute function vppsone.set_updated_at();

alter table vppsone.message_templates enable row level security;
create policy message_templates_select_authenticated
  on vppsone.message_templates for select to authenticated using (true);
grant select on vppsone.message_templates to authenticated;
grant all on vppsone.message_templates to service_role;


create table vppsone.message_sends (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  template_id uuid not null
    references vppsone.message_templates (id) on delete restrict,

  to_phone text not null,
  to_name text,

  -- Who or what it is about, when it is about somebody.
  student_id uuid,
  request_id uuid references vppsone.collection_requests (id) on delete set null,
  staff_profile_id uuid references vppsone.staff_profiles (id) on delete set null,

  variables text[] not null default '{}',

  -- The exact text as it will read, resolved at queue time. Kept because a
  -- template can be edited afterwards and "what did we actually send" must
  -- still have an answer.
  rendered_hi text not null,
  rendered_en text not null,

  status vppsone.send_status not null default 'draft',

  provider_message_id text,
  error text,

  requested_by uuid references vppsone.staff_profiles (id) on delete restrict,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint message_sends_sent_together
    check ((status = 'sent') = (sent_at is not null))
);

comment on table vppsone.message_sends is
  'One row per message the school means to send, with the text as it will read. A parent-facing send is pressed by a person (D-10).';

create index message_sends_queue_idx
  on vppsone.message_sends (session_label, status, requested_at desc);

create index message_sends_student_idx on vppsone.message_sends (student_id);

create trigger message_sends_set_updated_at
  before update on vppsone.message_sends
  for each row execute function vppsone.set_updated_at();

alter table vppsone.message_sends enable row level security;
create policy message_sends_select_authenticated
  on vppsone.message_sends for select to authenticated using (true);
grant select on vppsone.message_sends to authenticated;
grant all on vppsone.message_sends to service_role;


-- ---------------------------------------------------------------------------
-- rate_limits
-- ---------------------------------------------------------------------------
--
-- Counted in Postgres, not in memory. Vercel runs many instances and each
-- would keep its own tally, so an in-memory limit of 30 across ten instances
-- is really a limit of 300 — which is not a limit.
--
-- The whole check is one upsert: the CASE resets the window in the same
-- statement that increments it, so two concurrent requests cannot both decide
-- the window has expired and both reset the count to 1.

create table vppsone.rate_limits (
  bucket text primary key,
  hits integer not null default 0,
  window_started_at timestamptz not null default now()
);

comment on table vppsone.rate_limits is
  'Token buckets for the public token links. Counted in Postgres because the app runs on many instances.';

alter table vppsone.rate_limits enable row level security;
grant all on vppsone.rate_limits to service_role;

create or replace function vppsone.bump_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_ms integer
) returns table (allowed boolean, hits integer, retry_after_ms integer)
language plpgsql
security definer
set search_path = vppsone, pg_catalog
as $$
declare
  v_row vppsone.rate_limits%rowtype;
begin
  insert into vppsone.rate_limits as rl (bucket, hits, window_started_at)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
    set
      -- Reset and increment in one statement, so the window cannot be reset
      -- twice by two requests that both read it as expired.
      hits = case
        when rl.window_started_at < now() - make_interval(secs => p_window_ms / 1000.0)
        then 1
        else rl.hits + 1
      end,
      window_started_at = case
        when rl.window_started_at < now() - make_interval(secs => p_window_ms / 1000.0)
        then now()
        else rl.window_started_at
      end
  returning * into v_row;

  return query
  select
    v_row.hits <= p_limit,
    v_row.hits,
    greatest(
      0,
      (extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_ms / 1000.0) - now())) * 1000)::integer
    );
end;
$$;

revoke all on function vppsone.bump_rate_limit(text, integer, integer) from public;
grant execute on function vppsone.bump_rate_limit(text, integer, integer) to service_role;


-- ---------------------------------------------------------------------------
-- The fields the school already asks for
-- ---------------------------------------------------------------------------
--
-- Seeded rather than left empty, because a registry with nothing in it is a
-- screen nobody can use. Every one of these is a question the school already
-- asks on paper at admission.

insert into vppsone.collection_fields
  (key, label_hi, label_en, input_type, mode, exact_len, fee_column, sort_order, help_hi, help_en)
values
  ('guardian_phone', 'अभिभावक का फ़ोन', 'Guardian phone', 'tel', 'confirm', 10,
   'guardian_phone', 1,
   'भाई-बहन का एक ही नंबर होना सामान्य है।',
   'Siblings sharing one number is normal, not a mistake.'),
  ('mother_phone', 'माता का फ़ोन', 'Mother phone', 'tel', 'collect', 10, null, 2, null, null),
  ('date_of_birth', 'जन्म तिथि', 'Date of birth', 'date', 'confirm', null, 'date_of_birth', 3,
   null, 'Checked against an age of 2 to 22 years.'),
  ('aadhaar_last4', 'आधार के अंतिम 4 अंक', 'Aadhaar last 4 digits', 'text', 'collect', 4, null, 4,
   'पूरा आधार नंबर कभी न भरें।', 'Never the full number — the last four only.'),
  ('blood_group', 'रक्त समूह', 'Blood group', 'select', 'collect', null, null, 5, null, null),
  ('address', 'पता', 'Address', 'text', 'confirm', null, 'address', 6, null, null),
  ('transport', 'वाहन', 'Transport', 'select', 'collect', null, null, 7,
   'जो पैदल आते हैं उनके लिए "कोई नहीं" चुनें।',
   'Choose "None" for a child who walks — that is an answer, not a blank.')
on conflict do nothing;

update vppsone.collection_fields
set options = array['A+','A-','B+','B-','AB+','AB-','O+','O-']
where key = 'blood_group';

update vppsone.collection_fields
set options = array['School bus','Own vehicle','Walks','None']
where key = 'transport';
