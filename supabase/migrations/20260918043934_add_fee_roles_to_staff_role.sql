-- The fee app is being folded into VPPS One and retired, so its two
-- fee-desk roles become this app's own.
--
-- `accountant` is the role that sees the ported School Fees screens.
-- `fee_collector` works the follow-up list and takes no money.
--
-- Both are additive. Nothing is assigned here: Postgres refuses to USE an
-- enum value added in the same transaction that added it, so any row that
-- becomes an accountant does so in a later migration or at runtime.

alter type vppsone.staff_role add value if not exists 'accountant';
alter type vppsone.staff_role add value if not exists 'fee_collector';
