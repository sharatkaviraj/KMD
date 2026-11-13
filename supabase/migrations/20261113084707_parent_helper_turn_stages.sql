-- Veer Patta AI: where each answer's time went (D-605).
--
-- The owner, testing on 13 Nov 2026, found the helper slow and the typing
-- dots missing. The ledger kept one number per answer (`latency_ms`, from
-- the parent's message to the reply going out), which says that an answer
-- was slow but not which part. This adds the parts: the hand-off from Meta
-- through the hub, One's own checks, the hub's claim (when the parent sees
-- the blue ticks and the dots), the family's records, working out the
-- answer, Claude's share of it, a receipt PDF, and the send.
--
-- One nullable column, written by `finishTurn` as an object of whole
-- milliseconds. Metadata only, like the rest of the row: never what the
-- parent wrote.
--
-- Rollback: the column can stay; nothing reads it but people looking into a
-- slow answer.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.parent_helper_turns
  add column if not exists stages_ms jsonb
    check (stages_ms is null or jsonb_typeof(stages_ms) = 'object');

comment on column vppsone.parent_helper_turns.stages_ms is
  'Veer Patta AI (D-605): where this answer''s time went, in whole milliseconds: before (the parent''s message to One starting), checks, claim, dots (the parent''s message to the typing dots), family, compose, ai, receipt, waiting, send. Only the parts the turn reached.';

commit;
