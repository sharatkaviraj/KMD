-- The review queue is never deleted from or truncated over the API: rows
-- leave it only by being resolved (status), and a person's resolution is
-- the audit of a fees receipt posted after cutover. The vppsone default
-- privileges had granted service_role every table privilege; the intended
-- set is select, insert, update (20261030132121_tail_receipts_review.sql).
-- Pinned by tests/migrate-tooling.test.ts.
--
-- Rollback:
--   grant delete, truncate, references, trigger on vppsone.tail_receipts_review to service_role;

revoke delete, truncate, references, trigger on vppsone.tail_receipts_review from service_role;
