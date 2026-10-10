-- Fake staff notices for the teacher screens (TchHome news, TchMore news).
-- Dev only (wtgxcptmucjerhufzjcf). Invented text; idempotent.
insert into vppsone.message_campaigns (id, session_label, kind, title, body_hi, body_en, language, audience, class_ids, audience_label, recipient_count, cost_paise, status, client_request_id, created_by, created_at)
values
  ('a7e00000-0000-4000-8000-000000000001', '2026-27', 'staff', 'Staff meeting on Saturday', 'शनिवार को छुट्टी के बाद स्टाफ़ बैठक स्टाफ़ रूम में होगी।', 'Staff meeting after school on Saturday in the staff room.', 'both', 'staff', '{}', 'All staff', 0, 0, 'queued', 'a7e00000-0000-4000-8000-000000000101', '1520b49a-5e25-4a53-8f3d-210a4d35fbeb', now() - interval '3 hours'),
  ('a7e00000-0000-4000-8000-000000000002', '2026-27', 'staff', 'Half-yearly exam papers due', 'अर्धवार्षिक परीक्षा के प्रश्नपत्र शुक्रवार तक जमा करें।', 'Please hand in half-yearly question papers by Friday.', 'both', 'staff', '{}', 'All staff', 0, 0, 'queued', 'a7e00000-0000-4000-8000-000000000102', '0f2ecc32-6c5a-4f90-b741-8dad29b77c4b', now() - interval '1 day'),
  ('a7e00000-0000-4000-8000-000000000003', '2026-27', 'staff', 'Bus duty rota changed', 'अगले हफ़्ते की बस ड्यूटी सूची नोटिस बोर्ड पर है।', 'Next week''s bus duty list is on the notice board.', 'both', 'staff', '{}', 'All staff', 0, 0, 'queued', 'a7e00000-0000-4000-8000-000000000103', 'b606d827-fefd-4d84-9429-e8dd7f1f193c', now() - interval '3 days')
on conflict (id) do nothing;
