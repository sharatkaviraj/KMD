-- A request's title is text somebody typed, not a string this app ships.
--
-- Both halves were NOT NULL, so the office had to type the same sentence twice
-- before it could ask a teacher for a phone number — the most common task in
-- the app, doubled, to buy a translation nobody asked for (B-05). PLAN §3a:
-- "routine requests must not require two typed titles".
--
-- So one half is enough, and which one is a fact worth keeping: a Hindi reader
-- shown an English title is not broken, but the screen should be able to say
-- it fell back rather than pretend the author wrote it that way (B-14).
-- Storing the typed text in both columns would lose exactly that.

alter table vppsone.collection_requests
  alter column title_hi drop not null,
  alter column title_en drop not null;

-- An empty string is not an answer. Normalising it to null at the boundary
-- means "nothing was typed" has one representation rather than two, and the
-- check below can be about presence instead of about whitespace.
update vppsone.collection_requests set title_hi = null where btrim(title_hi) = '';
update vppsone.collection_requests set title_en = null where btrim(title_en) = '';

-- A request with no title at all is a teacher opening a link that does not say
-- what is being asked. One half is a choice; none is a bug.
alter table vppsone.collection_requests
  add constraint collection_requests_has_a_title
  check (
    coalesce(nullif(btrim(title_hi), ''), nullif(btrim(title_en), '')) is not null
  );

comment on column vppsone.collection_requests.title_hi is
  'Authored text, not a shipped string. Null when the author wrote only English; the reader falls back and the screen says so.';
comment on column vppsone.collection_requests.title_en is
  'Authored text, not a shipped string. Null when the author wrote only Hindi.';
