-- ============================================================================
-- VPPS One fee-migration (One-only): One's old practice rows leave the real
-- year before the D-644 copy (16 Nov 2026).
--
-- Why this differs from the fees app: these rows were never in the fees app.
-- Before the test-account fences (30 Oct) and the fee-writes switch (D-345),
-- QA accounts, smoke runs and owner rehearsals in One posted 29 practice
-- receipts (35 payment lines, 4 reversals, 1 discount) in the REAL year, most
-- against real children; made 6 practice children (OPS-, QA-TERRA-, 9959-9961)
-- with their fee rows; a practice class; a practice repayment plan; practice
-- follow-up notes; and two practice family groups from May. The D-644 copy
-- (vppsone.fees_copy_run) makes One's real year a copy of Fees, and it never
-- removes a row only One has, so this file does, once:
--
--   1. checks every listed row is there and that Fees has none of them;
--   2. checks nothing outside the list points at a listed row (so no foreign
--      key cascades or blanks anything else);
--   3. keeps each row, whole, in vppsone.fees_copy_quarantine
--      (20261116044409), the way back if one is ever wanted;
--   4. takes them out, children first, with the tables' own triggers off for
--      the delete (the append-only rules would refuse it; the audit trail of
--      this move is the quarantine table) and back in their prior mode after;
--   5. queues the money-view refresh.
--
-- The rows are listed by id, not found by a rule, so nothing else can be
-- caught. 153 rows: 149 in public (19 tables) and the 4 vppsone.enrolments of
-- the practice children (marked left on 14 Nov), so no roster row is left
-- pointing at a child who is gone.
--
-- Two of the 29 receipts were entered by the owner's own account, on 11 and
-- 16 Oct (SVP20261001-0001, SVP20261016-0001). Fees has no such payment; they
-- are moved with the rest, and the owner is asked whether either was real.
--
-- Applied with the Supabase CLI from the owner's PC (`supabase db query
-- --remote --yes -f`), because the MCP asks for a confirmation on DELETE that
-- nobody sees in time; the ledger row was written straight after it, under the
-- usual name, with the time it ran as its version.
--
-- Rollback: `insert into public.<table> select (jsonb_populate_record(null::public.<table>, row_data)).*
-- from vppsone.fees_copy_quarantine where table_name = '<table>'`, parents first,
-- with the same triggers off.
-- ============================================================================

begin;

set local lock_timeout = '30s';
set local statement_timeout = '10min';

create temp table q_rows (
  schema_name text not null,
  tbl text not null,
  id uuid not null,
  primary key (schema_name, tbl, id)
) on commit drop;

insert into q_rows (schema_name, tbl, id) values
  -- public.receipts: 29
  ('public', 'receipts', '07af0b4d-46e6-47b0-8823-504651dbf9ee'),
  ('public', 'receipts', '0f367722-2b7c-4ec2-ae99-9149c02f70a7'),
  ('public', 'receipts', '1c021fed-f468-4518-9729-13281d0552ce'),
  ('public', 'receipts', '1e467852-95c4-4461-8744-9807d54eb81f'),
  ('public', 'receipts', '2077ab5b-5cb7-41b2-9fa9-5c83cf87b035'),
  ('public', 'receipts', '25c45f2c-22f6-4ecd-8deb-6e1ba35c2fdd'),
  ('public', 'receipts', '25fe44dd-79e1-4d8b-8cdd-5b073682d7c8'),
  ('public', 'receipts', '3f5c2d10-4dda-431d-816f-91113a855a4c'),
  ('public', 'receipts', '587e0b8f-1b7c-49ff-b73b-da8115c6eee2'),
  ('public', 'receipts', '6b4b56e0-7dc1-4e65-81ed-e2a87e5b5075'),
  ('public', 'receipts', '6db4723c-3f4d-4014-9ed7-e5f30406f17c'),
  ('public', 'receipts', '7288b8aa-0cff-4d00-a615-6db069367344'),
  ('public', 'receipts', '745c9e8b-cc7f-4ee9-bee1-6feea8d7c550'),
  ('public', 'receipts', '7821379e-cabc-4cf3-9bfb-8fc1617b4f93'),
  ('public', 'receipts', '87d4161f-30cf-4cae-ae26-0986ccef6054'),
  ('public', 'receipts', '9e14a87c-ba69-4ccf-80ab-c8b1eaba1b23'),
  ('public', 'receipts', 'ac05afb1-2026-44ab-a45e-e88b6156fcda'),
  ('public', 'receipts', 'b7c4def4-8a90-4f4b-b74b-8b265c55736e'),
  ('public', 'receipts', 'ccfb3c0b-d6e7-4d6b-9ba3-300913a8b61a'),
  ('public', 'receipts', 'd6dc828a-08f7-4d2a-8bea-6551e47a37e7'),
  ('public', 'receipts', 'dae9682e-f0ba-475e-8103-f98c4c8d42b1'),
  ('public', 'receipts', 'e0777f95-8aac-4911-8875-436b82dbbbfb'),
  ('public', 'receipts', 'e2fc79db-3b22-4cad-ae9f-e00ad9441c47'),
  ('public', 'receipts', 'e636a9ca-99ae-41fd-b6bc-359fdec8988d'),
  ('public', 'receipts', 'f0e10905-66d4-409f-8d6b-2a9c6f53a645'),
  ('public', 'receipts', 'f21cb472-4516-4047-ad00-0fe96a8f2e8c'),
  ('public', 'receipts', 'f317e5a1-26b6-41c1-b07e-a97dfd08ef58'),
  ('public', 'receipts', 'f6514a79-f9b0-4a25-a77c-6c3718547110'),
  ('public', 'receipts', 'ff00a84c-854b-4a8c-8ec7-1dd133af706c'),
  -- public.payments: 35
  ('public', 'payments', '016120a0-7b0c-4db1-a12f-ba3bdbcf5566'),
  ('public', 'payments', '01759460-6f36-42d8-ab36-096aa52701fa'),
  ('public', 'payments', '0afb2861-7f9c-4b4b-9678-b06e9d23f2d7'),
  ('public', 'payments', '0c4be738-cb56-4221-bfad-b722a6640891'),
  ('public', 'payments', '107f1360-df6e-46bb-804a-d408d5d24b51'),
  ('public', 'payments', '224865be-495d-43e9-a8b7-456a2f3eb80c'),
  ('public', 'payments', '27ccf16e-0355-4170-a220-9f5efe17a20e'),
  ('public', 'payments', '2b11d048-d069-4a85-99d1-b319f535416d'),
  ('public', 'payments', '439f05f9-78a9-4643-b786-66ae22c23f96'),
  ('public', 'payments', '460204d2-543f-47fe-9494-c1eb9e9b1ba4'),
  ('public', 'payments', '479663ad-c70d-4441-b3b4-45c51f2c2a11'),
  ('public', 'payments', '482d3576-6475-4d56-b3be-8b6e9e003470'),
  ('public', 'payments', '48ba8a4e-d20d-4b8f-9e7f-5dfc492a4858'),
  ('public', 'payments', '539eca73-3e62-4fe3-9517-ccdd8b224903'),
  ('public', 'payments', '570b403f-35c6-428f-83ba-1576f7726a0a'),
  ('public', 'payments', '61132662-878c-4760-b279-a5d1102da682'),
  ('public', 'payments', '6ca0d101-6930-44c3-845e-1b5d778b3e62'),
  ('public', 'payments', '6cf998d8-800a-44f7-838e-980e89a6dde1'),
  ('public', 'payments', '74d1af2f-419a-470c-ac25-8cedda07be49'),
  ('public', 'payments', '7af659c7-7dc9-4ab5-9567-a1399996222d'),
  ('public', 'payments', '7b576a58-7741-4f56-b1ca-978c82e8e5dc'),
  ('public', 'payments', '96463d97-5caa-424d-a50e-97e4091725e8'),
  ('public', 'payments', '970be5bd-36dd-4f8e-961b-0acb8a0f2fa2'),
  ('public', 'payments', '9ca61755-72e2-41cf-8dca-08ae35e15f5f'),
  ('public', 'payments', '9e07e4e6-fce8-4ef6-b136-c05b88144fd2'),
  ('public', 'payments', 'a32d0419-792f-4dd2-8315-02c83b8bbbfc'),
  ('public', 'payments', 'a4429c35-5fa7-40eb-884a-6aa69b235e74'),
  ('public', 'payments', 'b8dc7cad-1d1f-4d47-b11d-7e067f3a655a'),
  ('public', 'payments', 'c462f21a-0481-4542-9586-ddf51187fe2d'),
  ('public', 'payments', 'c4e5474b-3132-4b56-9a9b-65103affed71'),
  ('public', 'payments', 'ddbd6bce-e62b-463c-bf42-22c7f7653fc5'),
  ('public', 'payments', 'e52000c6-1e0d-4b77-901f-deb300cf8e80'),
  ('public', 'payments', 'ea0c18be-3944-4e87-94db-77f63e1fe07e'),
  ('public', 'payments', 'efc1f636-38b9-4382-9854-f98abff98373'),
  ('public', 'payments', 'f415afce-0830-4c9a-babb-126d3d477fa8'),
  -- public.classes: 1
  ('public', 'classes', '7b7c681a-723a-446f-a43e-ac1df1578227'),
  -- public.defaulter_contacts: 3
  ('public', 'defaulter_contacts', '5f242981-f90a-4f52-85d7-f40b12a72232'),
  ('public', 'defaulter_contacts', '9f0d4cf4-bebf-4b93-9b8a-9a96a6d7c6a2'),
  ('public', 'defaulter_contacts', 'c8c3f1b2-d3ed-4656-990a-4b013525d818'),
  -- public.defaulter_recovery_state: 3
  ('public', 'defaulter_recovery_state', '834f28b1-085c-4d47-aa3c-b0becb55f6ca'),
  ('public', 'defaulter_recovery_state', '9b7df778-8908-4c30-913a-f55a711058af'),
  ('public', 'defaulter_recovery_state', 'd3e02df6-78b5-4b18-8870-bd50b65936cb'),
  -- public.installments: 20
  ('public', 'installments', '055be832-7222-4634-9ad9-93f035e1db16'),
  ('public', 'installments', '18e160fa-696f-40db-895c-beea1a5e167f'),
  ('public', 'installments', '1e454cb2-bcc8-4942-af0c-2beb80d25dda'),
  ('public', 'installments', '2ca6fb44-da1d-4b3b-8f89-ab544b3730c0'),
  ('public', 'installments', '2dbbadd5-6239-4307-b086-0cabe0e47a00'),
  ('public', 'installments', '3a9685a3-e034-479f-8b8c-995b9ec982d0'),
  ('public', 'installments', '51f15f7f-1b02-47b3-90c2-99fcef6096f7'),
  ('public', 'installments', '6b419895-94ae-4bf4-b4d8-c1ffdccb5d46'),
  ('public', 'installments', '6dc8aaee-e52c-43be-a559-aa6b0f1d60ec'),
  ('public', 'installments', '83ae004c-1a95-4079-925c-442d1867174d'),
  ('public', 'installments', '874574d1-4056-4589-812d-9a44726879c4'),
  ('public', 'installments', 'acf6ef02-d276-47b9-bd21-494ec5adbbb4'),
  ('public', 'installments', 'ae949689-27a6-4d3f-8fa6-151642933d43'),
  ('public', 'installments', 'afe368dc-edb1-4eba-9e30-6089f5b58d1f'),
  ('public', 'installments', 'd064f48b-6aee-49de-a2d3-9786d49625f9'),
  ('public', 'installments', 'd2d00454-efa6-4ab1-ad91-a441f2f96797'),
  ('public', 'installments', 'df1a69b0-4581-4859-8957-0f38065ce278'),
  ('public', 'installments', 'e3989283-608f-47f2-8229-9ca1ad05759e'),
  ('public', 'installments', 'f27763ed-3b3a-47d0-a6dd-5eac78d6ab30'),
  ('public', 'installments', 'f59526da-728f-4922-aabe-d406da524189'),
  -- public.payment_adjustments: 4
  ('public', 'payment_adjustments', '4b227f54-0b36-489c-958c-0d8fffd3887c'),
  ('public', 'payment_adjustments', '59b8f6e6-8d8f-4cbb-9f04-d73055eccf86'),
  ('public', 'payment_adjustments', '7751a5c7-5e5a-4d69-8bf8-44772e6bf300'),
  ('public', 'payment_adjustments', '80bb779b-4067-4b9c-8834-989cdd0939bc'),
  -- public.receipt_adjustments: 1
  ('public', 'receipt_adjustments', 'fbfdd508-34e0-4c29-b2ca-156be4029a59'),
  -- public.student_family_groups: 4
  ('public', 'student_family_groups', '2959ea01-c8cb-4a69-bb25-6517b0132a85'),
  ('public', 'student_family_groups', '3f3c80dc-a452-4c89-a6b2-57b466c1009d'),
  ('public', 'student_family_groups', '97ac5ce4-b491-4aaa-922c-795d66bfa322'),
  ('public', 'student_family_groups', 'cda961e4-d3cc-4cdf-b945-e3f0cb6d213c'),
  -- public.student_family_members: 6
  ('public', 'student_family_members', '18e01336-2b3c-466f-954a-e7a040e80664'),
  ('public', 'student_family_members', '640eb929-8877-4a76-a69a-747d44dffb71'),
  ('public', 'student_family_members', '69582c0c-514a-4beb-8128-0445b4647bf2'),
  ('public', 'student_family_members', '96391d57-ec06-458e-a4d2-dbc070dfdb5c'),
  ('public', 'student_family_members', '9984c1a6-3da0-496a-94c2-dc056d2bcc49'),
  ('public', 'student_family_members', 'd900986c-7d7e-4757-bf79-d56b5d41d4b4'),
  -- public.student_fee_overrides: 3
  ('public', 'student_fee_overrides', '62f0d01f-c2a3-4db0-ad4c-7a5e9a67ed98'),
  ('public', 'student_fee_overrides', '8a9bd8e7-a2fc-4757-84b2-8ff7218fd996'),
  ('public', 'student_fee_overrides', 'c2de0aa0-b31b-49a1-8753-90371e5012c2'),
  -- public.student_late_fee_waivers: 4
  ('public', 'student_late_fee_waivers', '717bf246-782c-4cb1-8805-e91617da613a'),
  ('public', 'student_late_fee_waivers', '7ab4deef-896f-4f5d-8ce2-9328d6d893ce'),
  ('public', 'student_late_fee_waivers', 'af8bdd4d-7104-4b6a-9dad-813d757e8280'),
  ('public', 'student_late_fee_waivers', 'dd5d9427-567f-4227-a48b-9f34447e83fe'),
  -- public.student_repayment_plan_items: 5
  ('public', 'student_repayment_plan_items', '374ef172-71fd-4ab3-9f2e-38f373c1b0a3'),
  ('public', 'student_repayment_plan_items', '6453d21b-c106-4439-8484-8c8084aca60d'),
  ('public', 'student_repayment_plan_items', '7b0b93be-0b85-40a2-b515-a4583a786491'),
  ('public', 'student_repayment_plan_items', '7b9bedd0-c07c-499a-80b6-99b76485a04e'),
  ('public', 'student_repayment_plan_items', 'c65856d6-ba70-4ac8-88eb-16074bcaf1c1'),
  -- public.student_repayment_plans: 1
  ('public', 'student_repayment_plans', 'caa66fc3-6fa1-45a3-ba44-7b57121a539e'),
  -- public.student_repayment_receipt_links: 2
  ('public', 'student_repayment_receipt_links', '1227e755-6eb1-4fb9-bdce-1d92d9212ecc'),
  ('public', 'student_repayment_receipt_links', '9a78eda9-d189-4790-86a2-dfd893c27614'),
  -- public.student_repayment_schedule: 12
  ('public', 'student_repayment_schedule', '03153166-54c8-4914-800d-c01613e9a8e8'),
  ('public', 'student_repayment_schedule', '07030486-2d02-4064-bd44-5e5378c008e0'),
  ('public', 'student_repayment_schedule', '12228f53-828f-4d3b-b30e-3084364b1721'),
  ('public', 'student_repayment_schedule', '289fe26d-73e0-4726-a479-a5a483723410'),
  ('public', 'student_repayment_schedule', '456c9070-0b0b-40f3-8ee2-57f49404261e'),
  ('public', 'student_repayment_schedule', '4a8d53ec-2d9f-4b45-b3bf-740fed28f98f'),
  ('public', 'student_repayment_schedule', '723ad441-802e-430a-b076-99d6da65e41c'),
  ('public', 'student_repayment_schedule', '77ebdc9d-5530-4859-87b5-feec5acae751'),
  ('public', 'student_repayment_schedule', '782dc765-2717-444a-ad7f-6ae213017b77'),
  ('public', 'student_repayment_schedule', 'd1c2b9ed-412d-40fa-bf91-77798a829a3e'),
  ('public', 'student_repayment_schedule', 'ef84648c-afdb-4159-a6bb-6f8cd64c5319'),
  ('public', 'student_repayment_schedule', 'f602143b-d07c-4c56-99e0-1d4b6767529b'),
  -- public.students: 6
  ('public', 'students', '19d86f1d-d78a-4589-b70e-4a9a4a82be9c'),
  ('public', 'students', '48af9254-132d-428d-b40a-4332caf9a510'),
  ('public', 'students', '4f0d0fb5-1714-4dae-af33-998977941d08'),
  ('public', 'students', '5e4830f3-fb39-46f1-a608-22a718ab25bd'),
  ('public', 'students', 'd6455b9b-ed68-4797-ae00-ee3c4b31189b'),
  ('public', 'students', 'e36b7179-f53a-42cf-b395-a3c429dcd807'),
  -- public.whatsapp_reminder_sends: 5
  ('public', 'whatsapp_reminder_sends', '1d76b6d1-3ad2-478d-998a-bd6e62b1e67a'),
  ('public', 'whatsapp_reminder_sends', '5ec54537-323c-48ff-b741-215033f7e3b3'),
  ('public', 'whatsapp_reminder_sends', '6aaf0334-84e7-41dd-bf46-b99974027033'),
  ('public', 'whatsapp_reminder_sends', 'ac00afb4-3dbc-453c-9e7d-a837ec381f69'),
  ('public', 'whatsapp_reminder_sends', 'c45d4174-f50d-4925-9599-7e7b5993d5d5'),
  -- public.whatsapp_send_attempts: 5
  ('public', 'whatsapp_send_attempts', '38d225ab-193c-4c0f-9a21-cbae6c8bdf00'),
  ('public', 'whatsapp_send_attempts', '5bd6ba52-d50b-45e7-8b4d-207d7369dabc'),
  ('public', 'whatsapp_send_attempts', '743de644-0e37-41db-ad8f-7931955efff5'),
  ('public', 'whatsapp_send_attempts', 'b687d09a-9aaa-4273-b30d-d33f54c2f9a5'),
  ('public', 'whatsapp_send_attempts', 'e91fa5fb-f774-49e3-b180-c5f0610f6f04'),
  -- vppsone.enrolments: 4
  ('vppsone', 'enrolments', 'f69d4ad5-b9ba-4444-b388-8281cc2341de'),
  ('vppsone', 'enrolments', '0c56d528-1626-4df0-940b-0d4ec410711f'),
  ('vppsone', 'enrolments', '15f235e1-bd19-4f76-80bc-8e1002944131'),
  ('vppsone', 'enrolments', '84d25def-caa4-496a-b36e-51c3bc7291d3')
;

-- 1. Every listed row is there, and Fees has none of them.
do $$
declare r record; n bigint;
begin
  if (select count(*) from pg_temp.q_rows) <> 153 then
    raise exception 'D-644 quarantine: the list has % rows, not 153', (select count(*) from pg_temp.q_rows);
  end if;
  for r in select schema_name, tbl, array_agg(id) as ids, count(*) as c from pg_temp.q_rows group by 1, 2 loop
    execute format('select count(*) from %I.%I where id = any($1)', r.schema_name, r.tbl) into n using r.ids;
    if n <> r.c then
      raise exception 'D-644 quarantine: %.% holds % of the % listed rows', r.schema_name, r.tbl, n, r.c;
    end if;
  end loop;
  perform vppsone.fees_copy_open();
  for r in select tbl, array_agg(id) as ids from pg_temp.q_rows where schema_name = 'public' group by 1 loop
    execute format('select count(*) from extensions.dblink(%L, %L) as f(id uuid) where f.id = any($1)',
                   'fees_copy', format('select id from public.%I', r.tbl))
      into n using r.ids;
    if n > 0 then
      raise exception 'D-644 quarantine: Fees has % of the listed public.% rows', n, r.tbl;
    end if;
  end loop;
  perform vppsone.fees_copy_close();
end $$;

-- 2. Nothing outside the list points at a listed row.
do $$
declare e record; n bigint; v_has_id boolean;
begin
  for e in
    select cn.nspname::text as cs, cc.relname::text as ct, pn.nspname::text as ps, pc.relname::text as pt,
           a.attname::text as ccol, co.conname::text as cname, cc.oid as coid
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class cc on cc.oid = co.conrelid
      join pg_catalog.pg_namespace cn on cn.oid = cc.relnamespace
      join pg_catalog.pg_class pc on pc.oid = co.confrelid
      join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace
      cross join lateral unnest(co.conkey, co.confkey) as k(cnum, pnum)
      join pg_catalog.pg_attribute pa on pa.attrelid = co.confrelid and pa.attnum = k.pnum and pa.attname = 'id'
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = k.cnum
     where co.contype = 'f'
       and exists (select 1 from pg_temp.q_rows q where q.schema_name = pn.nspname::text and q.tbl = pc.relname::text)
  loop
    select exists (select 1 from pg_catalog.pg_attribute x where x.attrelid = e.coid and x.attname = 'id' and x.attnum > 0 and not x.attisdropped)
      into v_has_id;
    if v_has_id then
      execute format($q$select count(*) from %I.%I c
                         where c.%I in (select q.id from pg_temp.q_rows q where q.schema_name = $1 and q.tbl = $2)
                           and c.id::text not in (select q.id::text from pg_temp.q_rows q where q.schema_name = $3 and q.tbl = $4)$q$,
                     e.cs, e.ct, e.ccol)
        into n using e.ps, e.pt, e.cs, e.ct;
    else
      execute format($q$select count(*) from %I.%I c
                         where c.%I in (select q.id from pg_temp.q_rows q where q.schema_name = $1 and q.tbl = $2)$q$,
                     e.cs, e.ct, e.ccol)
        into n using e.ps, e.pt;
    end if;
    if n > 0 then
      raise exception 'D-644 quarantine: % row(s) of %.% (%) point at a listed %.% row', n, e.cs, e.ct, e.cname, e.ps, e.pt;
    end if;
  end loop;
end $$;

-- 3. Keep each row, whole.
do $$
declare r record; n bigint;
begin
  for r in select distinct schema_name, tbl from pg_temp.q_rows loop
    execute format($q$insert into vppsone.fees_copy_quarantine (table_schema, table_name, row_pk, row_data, reason)
                      select %L, %L, t.id::text, pg_catalog.to_jsonb(t), %L
                        from %I.%I t
                       where t.id in (select q.id from pg_temp.q_rows q where q.schema_name = %L and q.tbl = %L)$q$,
                   r.schema_name, r.tbl,
                   'D-644: a practice row in the real year that Fees never had (QA, smoke or rehearsal), moved out before the copy',
                   r.schema_name, r.tbl, r.schema_name, r.tbl);
  end loop;
  select count(*) into n from vppsone.fees_copy_quarantine;
  if n <> 153 then raise exception 'D-644 quarantine: kept % rows, not 153', n; end if;
end $$;

-- 4. The tables' own triggers off, the rows out children first, the triggers
--    back in the mode each had.
create temp table q_trg on commit drop as
  select n.nspname::text as s, c.relname::text as t, tg.tgname::text as g, tg.tgenabled::text as mode
    from pg_catalog.pg_trigger tg
    join pg_catalog.pg_class c on c.oid = tg.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where not tg.tgisinternal and tg.tgenabled <> 'D'
     and exists (select 1 from pg_temp.q_rows q where q.schema_name = n.nspname::text and q.tbl = c.relname::text);

do $$
declare r record;
begin
  for r in select * from pg_temp.q_trg loop
    execute format('alter table %I.%I disable trigger %I', r.s, r.t, r.g);
  end loop;
end $$;

do $$
declare v_t text; v_s text; n bigint; v_want bigint;
begin
  foreach v_t in array array[
    'public.whatsapp_send_attempts', 'public.whatsapp_reminder_sends',
    'public.student_repayment_receipt_links', 'public.student_repayment_schedule',
    'public.student_repayment_plan_items', 'public.student_repayment_plans',
    'public.student_late_fee_waivers', 'public.receipt_adjustments', 'public.payment_adjustments',
    'public.payments', 'public.receipts', 'public.defaulter_recovery_state', 'public.defaulter_contacts',
    'public.student_family_members', 'public.student_family_groups', 'public.installments',
    'public.student_fee_overrides', 'vppsone.enrolments', 'public.students', 'public.classes']
  loop
    v_s := split_part(v_t, '.', 1);
    v_t := split_part(v_t, '.', 2);
    select count(*) into v_want from pg_temp.q_rows q where q.schema_name = v_s and q.tbl = v_t;
    execute format('delete from %I.%I where id in (select q.id from pg_temp.q_rows q where q.schema_name = %L and q.tbl = %L)',
                   v_s, v_t, v_s, v_t);
    get diagnostics n = row_count;
    if n <> v_want then
      raise exception 'D-644 quarantine: took % of the % listed rows from %.%', n, v_want, v_s, v_t;
    end if;
  end loop;
  if (select count(*) from (select distinct schema_name, tbl from pg_temp.q_rows) x) <> 20 then
    raise exception 'D-644 quarantine: the list names a table this step does not take rows from';
  end if;
end $$;

do $$
declare r record;
begin
  for r in select * from pg_temp.q_trg loop
    execute format('alter table %I.%I %s trigger %I', r.s, r.t,
                   case r.mode when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end, r.g);
  end loop;
  if exists (select 1
               from pg_temp.q_trg q
               join pg_catalog.pg_namespace n on n.nspname = q.s
               join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = q.t
               join pg_catalog.pg_trigger tg on tg.tgrelid = c.oid and tg.tgname = q.g
              where tg.tgenabled::text <> q.mode) then
    raise exception 'D-644 quarantine: a trigger did not come back in its own mode';
  end if;
end $$;

-- 5. The money views catch up within two minutes.
select public.queue_workbook_materialized_view_refresh();

commit;

select table_schema, table_name, count(*) as rows_kept from vppsone.fees_copy_quarantine group by 1, 2 order by 1, 2;
