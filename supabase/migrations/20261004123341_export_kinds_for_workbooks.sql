-- P10d: the student and round workbooks are logged where every other export
-- is — who took what, and when (`academic_exports`).

alter type vppsone.export_kind add value if not exists 'students';
alter type vppsone.export_kind add value if not exists 'round';
