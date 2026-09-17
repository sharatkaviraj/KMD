-- VPPS One — what a round asks for, before it has any links.
--
-- R3.1 gave a round an audience, a title and a due date but no fields: the
-- fields lived only on `collection_request_fields`, which needs a request, and
-- a request is a link. So a round could be written down on Tuesday and could
-- not say what it was going to ask until the fan-out ran on Wednesday — the
-- preview had nothing to preview.
--
-- This is the other half. The fan-out copies these onto each link it mints, so
-- `collection_request_fields` stays exactly what it is: what *this link* asks,
-- frozen with the rest of it.

create table vppsone.collection_round_fields (
  round_id uuid not null
    references vppsone.collection_rounds (id) on delete cascade,

  -- RESTRICT, matching `collection_request_fields`: a field somebody is still
  -- being asked for is not a field to delete out from under them.
  field_id uuid not null
    references vppsone.collection_fields (id) on delete restrict,

  -- The order the office chose, which is the order the teacher sees. Not the
  -- registry's own `sort_order`: a round asking for two things puts the one it
  -- cares about first, and re-sorting it into registry order would silently
  -- reverse that.
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),

  primary key (round_id, field_id)
);

comment on table vppsone.collection_round_fields is
  'What a round asks for. Copied onto each link at fan-out; collection_request_fields stays what THAT link asks.';

create index collection_round_fields_field_idx
  on vppsone.collection_round_fields (field_id);

alter table vppsone.collection_round_fields enable row level security;
create policy collection_round_fields_select_authenticated
  on vppsone.collection_round_fields for select to authenticated using (true);
grant select on vppsone.collection_round_fields to authenticated;
grant all on vppsone.collection_round_fields to service_role;
