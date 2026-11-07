-- D-485: every AI report download is logged in academic_exports like the
-- other bulk exports (who took which session, when, how many rows), so the
-- admin can see who took a file that holds the whole school's records.
alter type vppsone.export_kind add value if not exists 'ai_report';
