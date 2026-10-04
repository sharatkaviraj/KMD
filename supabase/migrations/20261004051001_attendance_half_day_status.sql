-- P6: a child who was in school for part of the day.
--
-- Its own migration because Postgres will not let a new enum value be used in
-- the transaction that adds it, and the next migration uses it.
alter type vppsone.attendance_status add value if not exists 'half_day';
