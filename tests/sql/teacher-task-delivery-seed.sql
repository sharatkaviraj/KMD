insert into vppsone.staff_profiles(id,user_id,role,is_active,display_name,whatsapp_phone) values
('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin',true,'Synthetic Admin',null),
('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','teacher',true,'Synthetic Teacher','+91 9000000000');
insert into vppsone.role_permissions values('admin','collection:manage');
insert into public.students(id,full_name) values('10000000-0000-4000-8000-000000000003','Synthetic Student');
insert into vppsone.enrolments(student_id,session_label,status) values('10000000-0000-4000-8000-000000000003','QA','enrolled');
insert into vppsone.collection_fields values('10000000-0000-4000-8000-000000000004','student_photo',null,true);
insert into vppsone.collection_requests(id,session_label,title_en,assigned_staff_id,token,status) values('10000000-0000-4000-8000-000000000005','QA','Synthetic task','10000000-0000-4000-8000-000000000002','synthetic-request-token','open');
insert into vppsone.collection_request_fields values('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000004');
insert into vppsone.collection_request_members(request_id,student_id) values('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003');
insert into vppsone.teacher_tasks(id,session_label,kind,source_key,request_id,scope,assigned_staff_id,title,token,created_by) values('10000000-0000-4000-8000-000000000006','QA','collection','synthetic-source','10000000-0000-4000-8000-000000000005','{"kind":"common","value":"selected"}','10000000-0000-4000-8000-000000000002','Synthetic task','synthetic-private-token','10000000-0000-4000-8000-000000000001');
