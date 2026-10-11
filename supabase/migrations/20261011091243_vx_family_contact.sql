-- Family contact outcomes (D-265).
--
-- The 11 October notes (§6): "Family contact should record what actually
-- happened: attempted, spoke, or follow-up agreed. Drafting a message does not
-- mean it was sent." A contact is a new kind on the existing follow-up record
-- rather than a second table, so the coordinator's attention lists, the
-- student's academic page and Student 360 all read one history.
--
-- Additive only: existing 'call' rows and their outcomes are untouched. A
-- contact can name the note it was about, and a "follow-up agreed" carries
-- the date that was agreed. Nothing here sends anything to a family.

alter table vppsone.student_followups
  add column if not exists agreed_on date,
  add column if not exists note_id uuid references vppsone.notes (id) on delete set null;

alter table vppsone.student_followups drop constraint if exists student_followups_kind_known;
alter table vppsone.student_followups
  add constraint student_followups_kind_known check (kind in ('call', 'improving', 'follow_up', 'contact'));

alter table vppsone.student_followups drop constraint if exists student_followups_outcome_known;
alter table vppsone.student_followups
  add constraint student_followups_outcome_known check (
    outcome is null
    or outcome in ('reached', 'no_answer', 'wrong_number', 'will_come', 'visit_school', 'attempted', 'spoke', 'follow_up_agreed')
  );

-- A contact always says how it went, with one of its own three outcomes; an
-- agreed date belongs only to "follow-up agreed", and is required there.
alter table vppsone.student_followups
  add constraint student_followups_contact_shape check (
    (kind <> 'contact' and agreed_on is null)
    or (kind = 'contact' and outcome in ('attempted', 'spoke') and agreed_on is null)
    or (kind = 'contact' and outcome = 'follow_up_agreed' and agreed_on is not null)
  );

comment on column vppsone.student_followups.agreed_on is
  'For a family contact whose outcome is follow_up_agreed: the date agreed with the family.';
comment on column vppsone.student_followups.note_id is
  'The note (support action) a family contact was about, when there was one.';
