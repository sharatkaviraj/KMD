-- ============================================================================
-- D-644 (16 Nov 2026): One's own copy of the Fees app's data.
--
-- Janmejay, 16 Nov 02:27 UTC: One becomes its own app; the office keeps using
-- the Fees app for now, and once One is complete all of Fees' data is brought
-- across. So One's real-year fee data is a copy of Fees, taken through the
-- read-only login (vppsone.fees_copy_open, 20261116025632), refreshed once a
-- night (D-457), and taken one last time on the day One takes over.
--
-- vppsone.fees_copy_run(mode) copies every row of every Fees `public` table One
-- shares, by primary key, in one transaction, from one consistent snapshot of
-- Fees (repeatable read):
--   * 'plan'     reads both sides and reports, per table, what it would insert,
--                change, leave and find only in One. It writes nothing.
--   * 'rehearse' does all of it and rolls back.
--   * 'apply'    does all of it for real.
-- vppsone.fees_copy_audit(max) brings Fees' audit_logs across, oldest first,
-- insert-only, from where the last call stopped.
--
-- What it never touches:
--   * TEST data on either side. A row is TEST when a session column
--     (session_label, from_session, ...) names a TEST-/UAT-/DEMO- session, when
--     its key is such a label, when it points (by foreign key, or by a
--     student_id / installment_id / receipt_id column) at a TEST row, when it
--     is an online-payment event of a TEST payment, or when it is a TEST twin
--     or shell One made (vppsone.migration_id_map). Fees' TEST rows are never
--     copied; One's TEST rows are never changed. A Fees real row whose key is
--     a TEST row in One (a "collision") stops 'rehearse' and 'apply'.
--   * One's own settings: app_settings except active_session_label and the
--     last-used notice settings of a real session, and every cell listed in
--     vppsone.one_owned_fee_settings (its row_key is the row's primary key, or
--     its session_label for a per-session table).
--   * Tables that are One's own or not school data (users, staff push
--     subscriptions, activity, office sync events, backup runs, the refresh
--     queue, online payment audit, notion log, reconcile log, setup progress,
--     number health). audit_logs comes across by vppsone.fees_copy_audit.
--   * Rows only One has. They are reported, never changed.
--
-- What it changes on the way in, so One never acts on Fees' work in progress:
-- queued outbox jobs become 'suppressed'; queued staff alerts 'no_devices' /
-- 'off'; open online orders 'abandoned'; open intents 'cancelled'; pending
-- online events 'ignored'; a capture Fees has not applied waits for a later
-- run; queued or sending reminder runs and their households 'stopped'. A Fees
-- staff account One does not have becomes null (vppsone.fees_copy_nulled_refs
-- keeps the original); a row that cannot lose it waits.
--
-- A row also waits, and is reported, when it would break a unique rule in One
-- (a row only One has holds the same receipt number, say), when a row it
-- points at waits, or when the database refuses it. Waiting rows are tried
-- again on the next run.
--
-- It refuses when the copy is retired (vppsone.fees_copy_settings.retired_at,
-- set the day One keeps its own records), when 'apply' finds fee writes open
-- in One (vppsone.fee_writes_open()), while another run holds the lock, when
-- the two schemas differ in a table it copies, and on a collision.
--
-- Writing: each written table's user triggers (audit, actor stamps, the D-345
-- guards, append-only rules) are switched off for the write and back on before
-- commit, under the ACCESS EXCLUSIVE lock that switching takes, so nobody else
-- writes in between; a trigger already off stays off. Foreign keys stay on.
-- After 'apply' a refresh of the money views is queued, which the
-- refresh-workbook-materialized-views job runs within two minutes. Every run
-- is a row in vppsone.fees_copy_runs.
--
-- Nothing here is reachable by anon, authenticated or service_role.
-- ============================================================================

create table if not exists vppsone.fees_copy_settings (
  id boolean primary key default true check (id),
  retired_at timestamptz,
  retired_reason text
);
insert into vppsone.fees_copy_settings (id) values (true) on conflict (id) do nothing;

create table if not exists vppsone.fees_copy_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text not null check (mode in ('plan', 'rehearse', 'apply', 'audit')),
  status text not null default 'running'
    check (status in ('running', 'planned', 'rehearsed', 'applied', 'refused', 'failed')),
  report jsonb,
  error text
);

create table if not exists vppsone.fees_copy_nulled_refs (
  table_name text not null,
  row_pk text not null,
  column_name text not null,
  fees_value text not null,
  first_run bigint not null,
  last_run bigint not null,
  primary key (table_name, row_pk, column_name)
);

create table if not exists vppsone.fees_copy_test_ids (
  table_name text not null,
  row_pk text not null,
  first_run bigint not null,
  primary key (table_name, row_pk)
);

create table if not exists vppsone.fees_copy_audit_state (
  id boolean primary key default true check (id),
  after_created_at timestamptz,
  after_id uuid,
  copied bigint not null default 0,
  updated_at timestamptz
);
insert into vppsone.fees_copy_audit_state (id) values (true) on conflict (id) do nothing;

alter table vppsone.fees_copy_settings enable row level security;
alter table vppsone.fees_copy_runs enable row level security;
alter table vppsone.fees_copy_nulled_refs enable row level security;
alter table vppsone.fees_copy_test_ids enable row level security;
alter table vppsone.fees_copy_audit_state enable row level security;
revoke all on table vppsone.fees_copy_settings, vppsone.fees_copy_runs, vppsone.fees_copy_nulled_refs,
  vppsone.fees_copy_test_ids, vppsone.fees_copy_audit_state from public, anon, authenticated;
grant select on table vppsone.fees_copy_runs, vppsone.fees_copy_settings to service_role;

-- The text of a row's primary key, from a jsonb row: one column as is, more
-- joined with '|'. The same expression on both sides, so they compare.
create or replace function vppsone.fees_copy_pk_expr(p_json text, p_cols text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when cardinality(p_cols) = 1 then format('(%s->>%L)', p_json, p_cols[1])
    else format('concat_ws(%L, %s)', '|',
                (select string_agg(format('%s->>%L', p_json, c), ', ' order by o)
                   from unnest(p_cols) with ordinality as u(c, o)))
  end
$$;

-- Set a key only where the row has it, so a rule never invents a column.
create or replace function vppsone.fees_copy_set(p_row jsonb, p_key text, p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_row ? p_key then jsonb_set(p_row, array[p_key], coalesce(p_value, 'null'::jsonb)) else p_row end
$$;

create or replace function vppsone.fees_copy_run(p_mode text default 'plan')
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '20min'
set lock_timeout = '30s'
as $fn$
declare
  c_skip constant text[] := array['users', 'user_activity_events', 'staff_push_subscriptions',
    'office_sync_events', 'backup_runs', 'workbook_materialized_view_refresh_queue', 'online_payment_audit',
    'notion_sync_log', 'session_reconcile_log', 'setup_progress', 'whatsapp_number_health', 'audit_logs'];
  c_fees_only constant text[] := array['timetable_slots', 'timetable_versions', 'teaching_assignments',
    'enrolments', 'staff_profiles', 'staff_access_links', 'class_aliases', 'subjects', 'feature_flags', 'job_runs'];
  -- Written after every table, because it closes a circle of references
  -- (installments <-> student_carry_forward_balances).
  c_late constant text[] := array['installments.carry_forward_balance_id'];
  c_test_re constant text := '^(test|uat|demo)-[0-9]{4}-[0-9]{2}$';
  c_session_col_re constant text := 'session(_label)?$';
  c_one_project constant text := 'wtgxcptmucjerhufzjcf';
  v_run bigint;
  v_rows text; v_meta text; v_edges text; v_urefs text;
  v_status text := 'running';
  v_refused boolean := false;
  v_err text;
  v_ctx text;
  v_problems jsonb := '[]'::jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_rules jsonb := '{}'::jsonb;
  v_written jsonb := '{}'::jsonb;
  v_report jsonb;
  v_coll jsonb := '[]'::jsonb;
  v_wait jsonb; v_extra jsonb; v_nulled jsonb; v_diffcols jsonb; v_counts jsonb;
  v_collisions bigint := 0;
  v_oid oid;
  v_one_cols text[]; v_gen text[]; v_missing text[]; v_nn text[]; v_pk text[];
  v_child_cols text[]; v_parent_pk text[];
  v_order text[] := '{}'; v_pending text[]; v_ready text[]; v_write_tables text[];
  v_trg jsonb := '[]'::jsonb;
  v_cols text[]; v_ins text[]; v_set text[]; v_late text[];
  v_tbl text; v_col text; v_lcol text; v_act text; v_done_act text;
  v_sql text; v_keys text; v_notnull text; v_join text;
  v_last_err text;
  v_pass integer; v_progress bigint;
  v_changed bigint; n bigint; n_ins bigint; n_upd bigint;
  r record; e record; t record; u record; g record; h record;
begin
  if p_mode is null or p_mode not in ('plan', 'rehearse', 'apply') then
    raise exception 'fees_copy_run: the mode is plan, rehearse or apply';
  end if;
  insert into vppsone.fees_copy_runs (mode) values (p_mode) returning id into v_run;

  begin
    if exists (select 1 from vppsone.fees_copy_settings s where s.retired_at is not null) then
      v_problems := v_problems || jsonb_build_object('refused', 'The copy is retired: One keeps its own fee records now.');
      raise exception using errcode = 'VPPCR', message = 'retired';
    end if;
    if p_mode = 'apply' and vppsone.fee_writes_open() then
      v_problems := v_problems || jsonb_build_object('refused',
        'Fee writes are open in One (fee_writes_enabled), so One may hold records Fees does not. The copy never overwrites them.');
      raise exception using errcode = 'VPPCR', message = 'fee writes open';
    end if;
    if not pg_try_advisory_xact_lock(hashtext('vppsone.fees_copy_run')) then
      v_problems := v_problems || jsonb_build_object('refused', 'Another copy is running.');
      raise exception using errcode = 'VPPCR', message = 'busy';
    end if;

    -- Both sides render rows to jsonb the same way.
    perform set_config('timezone', 'UTC', true);
    perform set_config('intervalstyle', 'postgres', true);
    perform vppsone.fees_copy_open();
    perform extensions.dblink_exec('fees_copy', 'rollback');
    perform extensions.dblink_exec('fees_copy', 'set timezone to ''UTC''');
    perform extensions.dblink_exec('fees_copy', 'set intervalstyle to ''postgres''');
    perform extensions.dblink_exec('fees_copy', 'begin isolation level repeatable read read only');

    v_rows := format('fc%s_rows', v_run);
    v_meta := format('fc%s_meta', v_run);
    v_edges := format('fc%s_edges', v_run);
    v_urefs := format('fc%s_urefs', v_run);
    execute format('create temp table %I (side text not null, tbl text not null, pk text not null, j jsonb not null,
                    is_test boolean not null default false, act text, why text, nulled jsonb,
                    primary key (side, tbl, pk))', v_rows);
    execute format('create index on %I (tbl, side)', v_rows);
    execute format('create temp table %I (tbl text primary key, pk_cols text[] not null, cols text[] not null,
                    gen_cols text[] not null, one_only text[] not null)', v_meta);
    -- child_expr is null for a reference to a key other than the parent's
    -- primary key: such an edge only orders the writes.
    execute format('create temp table %I (child text not null, parent text not null, child_col text not null,
                    child_expr text, is_late boolean not null, is_virtual boolean not null)', v_edges);
    execute format('create temp table %I (tbl text not null, col text not null, target text not null,
                    target_col text not null, not_null boolean not null)', v_urefs);

    ---------------------------------------------------------------- tables
    for r in
      select f.relname, f.cols
        from extensions.dblink('fees_copy', $q$
          select c.relname::text, array_agg(a.attname::text order by a.attnum)
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           where n.nspname = 'public' and c.relkind = 'r'
           group by c.relname $q$) as f(relname text, cols text[])
       order by 1
    loop
      if r.relname = any(c_skip) then
        v_tables := v_tables || jsonb_build_object(r.relname, jsonb_build_object('state', 'not copied'));
        continue;
      end if;
      v_oid := null;
      select c.oid into v_oid
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = r.relname and c.relkind = 'r';
      if v_oid is null then
        if r.relname = any(c_fees_only) or r.relname like 'household\_%' then
          v_tables := v_tables || jsonb_build_object(r.relname, jsonb_build_object('state', 'Fees only'));
        else
          v_problems := v_problems || jsonb_build_object('drift', format('Fees has the table %s and One does not.', r.relname));
        end if;
        continue;
      end if;
      select coalesce(array_agg(a.attname::text order by a.attnum) filter (where a.attgenerated = ''), '{}'),
             coalesce(array_agg(a.attname::text order by a.attnum) filter (where a.attgenerated <> ''), '{}'),
             coalesce(array_agg(a.attname::text order by a.attnum)
                        filter (where a.attgenerated = '' and a.attnotnull and not a.atthasdef and a.attidentity = ''
                                  and a.attname::text <> all(r.cols)), '{}')
        into v_one_cols, v_gen, v_nn
        from pg_catalog.pg_attribute a
       where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped;
      v_missing := array(select x from unnest(r.cols) x where x <> all(v_one_cols || v_gen));
      if cardinality(v_missing) > 0 then
        v_problems := v_problems || jsonb_build_object('drift',
          format('%s: One has no %s.', r.relname, array_to_string(v_missing, ', ')));
        continue;
      end if;
      if cardinality(v_nn) > 0 then
        v_problems := v_problems || jsonb_build_object('drift',
          format('%s: One needs %s, which Fees does not have.', r.relname, array_to_string(v_nn, ', ')));
        continue;
      end if;
      v_pk := null;
      select array_agg(a.attname::text order by k.ord) into v_pk
        from pg_catalog.pg_constraint co
        cross join lateral unnest(co.conkey) with ordinality as k(attnum, ord)
        join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = k.attnum
       where co.conrelid = v_oid and co.contype = 'p';
      if v_pk is null then
        v_problems := v_problems || jsonb_build_object('drift', format('%s has no primary key in One.', r.relname));
        continue;
      end if;
      execute format('insert into %I values ($1, $2, $3, $4, $5)', v_meta)
        using r.relname, v_pk,
              array(select x from unnest(v_one_cols) x where x = any(r.cols)),
              v_gen,
              array(select x from unnest(v_one_cols) x where x <> all(r.cols));
    end loop;

    ---------------------------------------------------------------- references
    for e in
      select co.conkey, co.confkey, co.conrelid, co.confrelid, cc.relname::text as child,
             pc.relname::text as parent, pn.nspname::text as parent_ns
        from pg_catalog.pg_constraint co
        join pg_catalog.pg_class cc on cc.oid = co.conrelid
        join pg_catalog.pg_namespace cn on cn.oid = cc.relnamespace
        join pg_catalog.pg_class pc on pc.oid = co.confrelid
        join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace
       where co.contype = 'f' and cn.nspname = 'public'
    loop
      v_pk := null;
      v_parent_pk := null;
      execute format('select pk_cols from %I where tbl = $1', v_meta) into v_pk using e.child;
      continue when v_pk is null;  -- the child table is not copied
      if e.parent_ns = 'public' then
        execute format('select pk_cols from %I where tbl = $1', v_meta) into v_parent_pk using e.parent;
      end if;
      if v_parent_pk is not null then
        -- The child columns that hold the parent's primary key, in its order.
        v_child_cols := array(
          select ca.attname::text
            from unnest(v_parent_pk) with ordinality as p(col, ord)
            join unnest(e.confkey, e.conkey) with ordinality as k(pnum, cnum, i) on true
            join pg_catalog.pg_attribute pa on pa.attrelid = e.confrelid and pa.attnum = k.pnum and pa.attname::text = p.col
            join pg_catalog.pg_attribute ca on ca.attrelid = e.conrelid and ca.attnum = k.cnum
           order by p.ord);
        if cardinality(v_child_cols) = cardinality(v_parent_pk) then
          execute format('insert into %I values ($1, $2, $3, $4, $5, false)', v_edges)
            using e.child, e.parent, v_child_cols[1], vppsone.fees_copy_pk_expr('c.j', v_child_cols),
                  cardinality(v_child_cols) = 1 and (e.child || '.' || v_child_cols[1]) = any(c_late);
        else
          execute format('insert into %I values ($1, $2, $3, null, false, false)', v_edges)
            using e.child, e.parent,
                  (select a.attname::text from pg_catalog.pg_attribute a where a.attrelid = e.conrelid and a.attnum = e.conkey[1]);
        end if;
      elsif cardinality(e.conkey) = 1 then
        -- A reference to a row the copy does not write (a staff account,
        -- mostly): the value must already be in One, or it becomes null.
        execute format('insert into %I select $1, ca.attname::text, $2, pa.attname::text, ca.attnotnull
                          from pg_catalog.pg_attribute ca, pg_catalog.pg_attribute pa
                         where ca.attrelid = $3 and ca.attnum = $4 and pa.attrelid = $5 and pa.attnum = $6', v_urefs)
          using e.child, format('%I.%I', e.parent_ns, e.parent), e.conrelid, e.conkey[1], e.confrelid, e.confkey[1];
      end if;
    end loop;

    -- A student_id / installment_id / receipt_id column without a foreign key
    -- still says whose row it is (the change snapshots, the send attempts).
    for g in select v.col, v.parent from (values ('student_id', 'students'), ('installment_id', 'installments'),
                                                 ('receipt_id', 'receipts')) as v(col, parent)
    loop
      execute format($q$insert into %1$I (child, parent, child_col, child_expr, is_late, is_virtual)
                        select m.tbl, $1, $2, '(c.j->>' || pg_catalog.quote_literal($2) || ')', false, true
                          from %2$I m
                         where $2 = any(m.cols) and m.tbl <> $1
                           and exists (select 1 from %2$I p where p.tbl = $1 and p.pk_cols = array['id'])
                           and not exists (select 1 from %1$I x where x.child = m.tbl and x.child_col = $2
                                             and x.child_expr is not null)$q$, v_edges, v_meta)
        using g.parent, g.col;
    end loop;

    ---------------------------------------------------------------- read both sides
    for t in execute format('select tbl, pk_cols from %I order by tbl', v_meta) loop
      execute format('insert into %I (side, tbl, pk, j) select ''fees'', $1, %s, f.j
                        from extensions.dblink(''fees_copy'', $2) as f(j jsonb)',
                     v_rows, vppsone.fees_copy_pk_expr('f.j', t.pk_cols))
        using t.tbl, format('select pg_catalog.to_jsonb(fc__r) from public.%I fc__r', t.tbl);
      execute format('insert into %I (side, tbl, pk, j) select ''one'', $1, %s, f.j
                        from (select pg_catalog.to_jsonb(fc__r) as j from public.%I fc__r) f',
                     v_rows, vppsone.fees_copy_pk_expr('f.j', t.pk_cols), t.tbl)
        using t.tbl;
    end loop;
    execute format('analyze %I', v_rows);

    ---------------------------------------------------------------- TEST rows
    for t in execute format('select m.tbl, c.col from %I m, unnest(m.cols || m.one_only) as c(col) where c.col ~ $1', v_meta)
      using c_session_col_re
    loop
      execute format('update %I set is_test = true where tbl = $1 and not is_test and pg_catalog.lower(j->>$2) ~ $3', v_rows)
        using t.tbl, t.col, c_test_re;
    end loop;
    execute format($q$update %I set is_test = true
                       where not is_test
                         and (pg_catalog.lower(pk) ~ $1
                           or (tbl = 'app_settings' and pg_catalog.lower(pg_catalog.split_part(pk, ':', -1)) ~ $1))$q$, v_rows)
      using c_test_re;
    execute format($q$update %I r set is_test = true
                        from vppsone.migration_id_map m
                       where r.side = 'one' and not r.is_test and m.source_project = $1
                         and m.source_table = 'public.' || r.tbl and r.pk = m.target_id::text$q$, v_rows)
      using c_one_project;
    loop
      v_changed := 0;
      for e in execute format('select child, parent, child_expr from %I where child_expr is not null', v_edges) loop
        execute format('update %1$I c set is_test = true
                         where c.tbl = $1 and not c.is_test
                           and exists (select 1 from %1$I p where p.side = c.side and p.tbl = $2 and p.pk = %2$s and p.is_test)',
                       v_rows, e.child_expr)
          using e.child, e.parent;
        get diagnostics n = row_count;
        v_changed := v_changed + n;
      end loop;
      execute format($q$update %1$I c set is_test = true
                         where c.tbl = 'online_payment_events' and not c.is_test
                           and exists (select 1 from %1$I p
                                        where p.side = c.side and p.is_test
                                          and p.tbl in ('online_payment_captures', 'online_payment_intents', 'online_payment_orders')
                                          and ((c.j->>'provider_payment_id' is not null
                                                and p.j->>'provider_payment_id' = c.j->>'provider_payment_id')
                                            or (c.j->>'provider_link_id' is not null
                                                and p.j->>'provider_link_id' = c.j->>'provider_link_id')))$q$, v_rows);
      get diagnostics n = row_count;
      v_changed := v_changed + n;
      exit when v_changed = 0;
    end loop;

    execute format($q$select count(*),
                             coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table', x.tbl, 'id', x.pk))
                                        filter (where x.rn <= 100), '[]'::jsonb)
                        from (select f.tbl, f.pk, row_number() over (order by f.tbl, f.pk) as rn
                                from %1$I f join %1$I o on o.side = 'one' and o.tbl = f.tbl and o.pk = f.pk
                               where f.side = 'fees' and not f.is_test and o.is_test) x$q$, v_rows)
      into v_collisions, v_coll;
    execute format($q$update %1$I f set act = 'collision'
                        from %1$I o
                       where f.side = 'fees' and not f.is_test and o.side = 'one' and o.tbl = f.tbl and o.pk = f.pk
                         and o.is_test$q$, v_rows);
    execute format($q$update %I set act = 'test' where is_test$q$, v_rows);

    ---------------------------------------------------------------- One's own settings
    execute format($q$update %I set act = 'one owned'
                       where tbl = 'app_settings' and act is null and pk <> 'active_session_label'
                         and pk not like 'whatsapp\_last\_used\_notice\_settings:%%'$q$, v_rows);
    for g in select s.source_table, s.row_key, s.column_name from vppsone.one_owned_fee_settings s loop
      execute format($q$update %1$I f set j = vppsone.fees_copy_set(f.j, $3, o.j->$3)
                          from %1$I o
                         where f.side = 'fees' and f.tbl = $1 and f.act is null
                           and (f.pk = $2 or f.j->>'session_label' = $2)
                           and o.side = 'one' and o.tbl = f.tbl and o.pk = f.pk and o.j ? $3$q$, v_rows)
        using g.source_table, g.row_key, g.column_name;
    end loop;

    ---------------------------------------------------------------- Fees' work in progress
    execute format($q$update %I set j = vppsone.fees_copy_set(vppsone.fees_copy_set(j, 'status', '"suppressed"'), 'locked_until', 'null')
                       where side = 'fees' and tbl = 'notification_outbox' and act is null
                         and coalesce(j->>'status', '') not in ('provider_accepted', 'delivered', 'suppressed', 'uncertain')$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('notification_outbox: queued jobs made suppressed', n);

    execute format($q$update %I set j = vppsone.fees_copy_set(vppsone.fees_copy_set(vppsone.fees_copy_set(j,
                         'push_status', case when j->>'push_status' = 'queued' then '"no_devices"'::jsonb else j->'push_status' end),
                         'whatsapp_status', case when j->>'whatsapp_status' = 'queued' then '"off"'::jsonb else j->'whatsapp_status' end),
                         'locked_until', 'null')
                       where side = 'fees' and tbl = 'staff_payment_alerts' and act is null
                         and (j->>'push_status' = 'queued' or j->>'whatsapp_status' = 'queued' or j->>'locked_until' is not null)$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('staff_payment_alerts: queued alerts closed', n);

    execute format($q$update %I set j = vppsone.fees_copy_set(j, 'status', '"abandoned"')
                       where side = 'fees' and tbl = 'online_payment_orders' and act is null
                         and coalesce(j->>'status', '') not in ('accounted', 'superseded', 'abandoned', 'failed')$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('online_payment_orders: open orders made abandoned', n);

    execute format($q$update %I set j = vppsone.fees_copy_set(vppsone.fees_copy_set(j, 'status', '"cancelled"'),
                         'provider_cancelled_at',
                         case when coalesce(j->'provider_cancelled_at', 'null'::jsonb) = 'null'::jsonb
                              then coalesce(j->'updated_at', j->'created_at') else j->'provider_cancelled_at' end)
                       where side = 'fees' and tbl = 'online_payment_intents' and act is null
                         and coalesce(j->>'status', '') not in ('accounted', 'superseded', 'cancelled', 'expired', 'failed')$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('online_payment_intents: open intents made cancelled', n);

    execute format($q$update %I set j = vppsone.fees_copy_set(j, 'status', '"ignored"')
                       where side = 'fees' and tbl = 'online_payment_events' and act is null
                         and coalesce(j->>'status', '') not in ('processed', 'ignored')$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('online_payment_events: pending events made ignored', n);

    execute format($q$update %I set act = 'wait', why = 'an online payment Fees has not applied yet'
                       where side = 'fees' and tbl = 'online_payment_captures' and act is null
                         and coalesce(j->>'application_status', '') <> 'applied'$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('online_payment_captures: not applied yet, waiting', n);

    execute format($q$update %I set j = vppsone.fees_copy_set(vppsone.fees_copy_set(vppsone.fees_copy_set(j,
                         'dispatch_state', '"stopped"'), 'worker_id', 'null'), 'worker_lease_until', 'null')
                       where side = 'fees' and tbl = 'whatsapp_campaign_runs' and act is null
                         and j->>'dispatch_state' in ('queued', 'sending')$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('whatsapp_campaign_runs: queued or sending runs made stopped', n);

    execute format($q$update %I set j = vppsone.fees_copy_set(vppsone.fees_copy_set(vppsone.fees_copy_set(j,
                         'state', '"stopped"'), 'claimed_by', 'null'), 'claimed_at', 'null')
                       where side = 'fees' and tbl = 'whatsapp_run_households' and act is null
                         and j->>'state' in ('pending', 'sending')$q$, v_rows);
    get diagnostics n = row_count;
    v_rules := v_rules || jsonb_build_object('whatsapp_run_households: pending or sending made stopped', n);

    ---------------------------------------------------------------- staff accounts One lacks
    for u in execute format('select tbl, col, target, target_col, not_null from %I order by 1, 2', v_urefs) loop
      if u.not_null then
        execute format($q$update %1$I r set act = 'wait', why = pg_catalog.format('%%s %%s is not in One', $2, r.j->>$2)
                           where r.side = 'fees' and r.tbl = $1 and r.act is null and r.j->>$2 is not null
                             and not exists (select 1 from %2$s x where x.%3$I::text = r.j->>$2)$q$,
                       v_rows, u.target, u.target_col)
          using u.tbl, u.col;
      else
        execute format($q$update %1$I r set nulled = coalesce(r.nulled, '{}'::jsonb) || pg_catalog.jsonb_build_object($2, r.j->>$2),
                                            j = pg_catalog.jsonb_set(r.j, array[$2], 'null'::jsonb)
                           where r.side = 'fees' and r.tbl = $1 and r.act is null and r.j->>$2 is not null
                             and not exists (select 1 from %2$s x where x.%3$I::text = r.j->>$2)$q$,
                       v_rows, u.target, u.target_col)
          using u.tbl, u.col;
      end if;
    end loop;

    ---------------------------------------------------------------- compare
    execute format($q$update %1$I f set act = 'insert'
                       where f.side = 'fees' and f.act is null
                         and not exists (select 1 from %1$I o where o.side = 'one' and o.tbl = f.tbl and o.pk = f.pk)$q$, v_rows);
    execute format($q$update %1$I f set act = case when (f.j - m.ign) = (o.j - m.ign) then 'same' else 'update' end
                        from %1$I o, (select tbl, gen_cols || one_only as ign from %2$I) m
                       where f.side = 'fees' and f.act is null and o.side = 'one' and o.tbl = f.tbl and o.pk = f.pk
                         and m.tbl = f.tbl$q$, v_rows, v_meta);
    execute format($q$update %1$I o set act = 'extra'
                       where o.side = 'one' and o.act is null
                         and not exists (select 1 from %1$I f where f.side = 'fees' and f.tbl = o.tbl and f.pk = o.pk
                                           and not f.is_test)$q$, v_rows);

    ---------------------------------------------------------------- unique rules
    -- After the copy, every unique index must still hold over the rows One will
    -- have: the Fees rows written or already equal, and One's rows they do not
    -- replace. A Fees row that would break one waits.
    execute format($q$select coalesce(array_agg(distinct tbl), '{}') from %I where side = 'fees' and act in ('insert', 'update')$q$, v_rows)
      into v_write_tables;
    for g in
      select c.relname::text as tbl, ic.relname::text as idx, i.indexrelid, i.indnkeyatts::integer as nkeys,
             i.indnullsnotdistinct as nnd, pg_catalog.pg_get_expr(i.indpred, i.indrelid, true) as pred
        from pg_catalog.pg_index i
        join pg_catalog.pg_class c on c.oid = i.indrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_class ic on ic.oid = i.indexrelid
       where n.nspname = 'public' and i.indisunique and not i.indisprimary and i.indisvalid
         and c.relname::text = any(v_write_tables)
       order by 1, 2
    loop
      select string_agg(format('(%s)', pg_catalog.pg_get_indexdef(g.indexrelid, k, true)), ', ' order by k),
             string_agg(format(' and (%s) is not null', pg_catalog.pg_get_indexdef(g.indexrelid, k, true)), '' order by k)
        into v_keys, v_notnull
        from generate_series(1, g.nkeys) as k;
      execute format($q$
        with fin as (
          select r.side as fc__side, r.pk as fc__pk, r.act as fc__act, x.*
            from %1$I r cross join lateral pg_catalog.jsonb_populate_record(null::public.%2$I, r.j) x
           where r.tbl = $1
             and ((r.side = 'fees' and r.act in ('insert', 'update', 'same'))
               or (r.side = 'one' and not exists (select 1 from %1$I f where f.side = 'fees' and f.tbl = $1 and f.pk = r.pk
                                                    and f.act in ('insert', 'update', 'same'))))
        ), k as (
          select fc__side, fc__pk, fc__act, pg_catalog.jsonb_build_array(%3$s) as fc__key from fin where (%4$s)%5$s
        ), clash as (
          select fc__key, pg_catalog.string_agg(fc__side || ' ' || fc__pk, ', ') as fc__members
            from k group by fc__key
          having count(*) > 1 and bool_or(fc__side = 'fees' and fc__act in ('insert', 'update'))
        )
        update %1$I r set act = 'wait', why = pg_catalog.format('unique %%s %%s is also on %%s', $2, c.fc__key, c.fc__members)
          from k join clash c on c.fc__key = k.fc__key
         where r.side = 'fees' and r.tbl = $1 and r.pk = k.fc__pk and k.fc__side = 'fees'
           and r.act in ('insert', 'update')$q$,
        v_rows, g.tbl, v_keys, coalesce(g.pred, 'true'), case when g.nnd then '' else v_notnull end)
        using g.tbl, g.idx;
      get diagnostics n = row_count;
      if n > 0 then
        v_rules := v_rules || jsonb_build_object(format('%s: waiting on unique %s', g.tbl, g.idx), n);
      end if;
    end loop;

    ---------------------------------------------------------------- what waits, waits with its children
    loop
      v_changed := 0;
      for e in execute format('select child, parent, child_expr from %I where child_expr is not null and not is_virtual', v_edges) loop
        execute format($q$update %1$I c set act = 'wait', why = pg_catalog.format('waits for %%s %%s', $2, p.pk)
                           from %1$I p
                          where c.side = 'fees' and c.tbl = $1 and c.act in ('insert', 'update')
                            and p.side = 'fees' and p.tbl = $2 and p.pk = %2$s and p.act = 'wait'
                            and not exists (select 1 from %1$I o where o.side = 'one' and o.tbl = $2 and o.pk = p.pk
                                              and not o.is_test)$q$, v_rows, e.child_expr)
          using e.child, e.parent;
        get diagnostics n = row_count;
        v_changed := v_changed + n;
      end loop;
      exit when v_changed = 0;
    end loop;

    ---------------------------------------------------------------- order of writing
    execute format('select coalesce(array_agg(tbl order by tbl), ''{}'') from %I', v_meta) into v_pending;
    while cardinality(v_pending) > 0 loop
      execute format('select coalesce(array_agg(p.t order by p.t), ''{}'') from unnest($1) as p(t)
                       where not exists (select 1 from %I e where e.child = p.t and e.parent <> p.t
                                           and not e.is_late and not e.is_virtual and e.parent = any($1))', v_edges)
        into v_ready using v_pending;
      if cardinality(v_ready) = 0 then
        v_problems := v_problems || jsonb_build_object('order',
          format('These tables point at each other in a circle: %s', array_to_string(v_pending, ', ')));
        exit;
      end if;
      v_order := v_order || v_ready;
      v_pending := array(select p from unnest(v_pending) p where p <> all(v_ready));
    end loop;

    if p_mode <> 'plan' then
      if exists (select 1 from jsonb_array_elements(v_problems) x where x ? 'drift' or x ? 'order') then
        v_refused := true;
        v_problems := v_problems || jsonb_build_object('refused', 'The two schemas differ; nothing was written.');
      end if;
      if v_collisions > 0 then
        v_refused := true;
        v_problems := v_problems || jsonb_build_object('refused',
          format('%s Fees rows have the key of a TEST row in One; nothing was written.', v_collisions));
      end if;
    end if;

    ---------------------------------------------------------------- write
    if p_mode <> 'plan' and not v_refused then
      foreach v_tbl in array v_order loop
        execute format($q$select count(*) filter (where act = 'insert'), count(*) filter (where act = 'update')
                            from %I where side = 'fees' and tbl = $1$q$, v_rows)
          into n_ins, n_upd using v_tbl;
        continue when n_ins + n_upd = 0;
        execute format('select pk_cols, cols from %I where tbl = $1', v_meta) into v_pk, v_cols using v_tbl;
        v_late := array(select pg_catalog.split_part(x, '.', 2) from unnest(c_late) x where pg_catalog.split_part(x, '.', 1) = v_tbl);
        v_ins := array(select c from unnest(v_cols) c where c <> all(v_late));
        v_set := array(select c from unnest(v_cols) c where c <> all(v_late) and c <> all(v_pk));
        v_join := (select string_agg(format('fc__t.%1$I = fc__x.%1$I', c), ' and ') from unnest(v_pk) c);

        for h in select tg.tgname::text as name, tg.tgenabled::text as mode
                   from pg_catalog.pg_trigger tg
                  where tg.tgrelid = format('public.%I', v_tbl)::regclass and not tg.tgisinternal and tg.tgenabled <> 'D'
                  order by tg.tgname
        loop
          execute format('alter table public.%I disable trigger %I', v_tbl, h.name);
          v_trg := v_trg || jsonb_build_object('t', v_tbl, 'name', h.name, 'mode', h.mode);
        end loop;

        foreach v_act in array array['insert', 'update'] loop
          continue when (v_act = 'insert' and n_ins = 0) or (v_act = 'update' and (n_upd = 0 or cardinality(v_set) = 0));
          v_done_act := case v_act when 'insert' then 'inserted' else 'updated' end;
          if v_act = 'insert' then
            v_sql := format('insert into public.%I (%s) overriding system value select %s
                               from %I fc__r cross join lateral pg_catalog.jsonb_populate_record(null::public.%I, fc__r.j) fc__x
                              where fc__r.side = ''fees'' and fc__r.tbl = $1 and fc__r.act = ''insert''',
                            v_tbl, (select string_agg(format('%I', c), ', ') from unnest(v_ins) c),
                            (select string_agg(format('fc__x.%I', c), ', ') from unnest(v_ins) c), v_rows, v_tbl);
          else
            v_sql := format('update public.%I fc__t set (%s) = row(%s)
                               from %I fc__r cross join lateral pg_catalog.jsonb_populate_record(null::public.%I, fc__r.j) fc__x
                              where fc__r.side = ''fees'' and fc__r.tbl = $1 and fc__r.act = ''update'' and %s',
                            v_tbl, (select string_agg(format('%I', c), ', ') from unnest(v_set) c),
                            (select string_agg(format('fc__x.%I', c), ', ') from unnest(v_set) c), v_rows, v_tbl, v_join);
          end if;
          begin
            execute v_sql using v_tbl;
            get diagnostics n = row_count;
          exception when others then
            -- One by one, a few passes (a row can need one written later in
            -- the same table); what is still refused waits.
            get stacked diagnostics v_last_err = message_text;
            n := 0;
            v_pass := 0;
            loop
              v_pass := v_pass + 1;
              v_progress := 0;
              for g in execute format('select pk from %I where side = ''fees'' and tbl = $1 and act = $2 order by pk', v_rows)
                using v_tbl, v_act
              loop
                begin
                  execute v_sql || ' and fc__r.pk = $2' using v_tbl, g.pk;
                  execute format('update %I set act = $3, why = null where side = ''fees'' and tbl = $1 and pk = $2', v_rows)
                    using v_tbl, g.pk, v_done_act;
                  v_progress := v_progress + 1;
                exception when others then
                  get stacked diagnostics v_last_err = message_text;
                  execute format('update %I set why = $3 where side = ''fees'' and tbl = $1 and pk = $2', v_rows)
                    using v_tbl, g.pk, 'refused: ' || v_last_err;
                end;
              end loop;
              n := n + v_progress;
              exit when v_progress = 0 or v_pass >= 5;
            end loop;
            execute format('update %I set act = ''wait'' where side = ''fees'' and tbl = $1 and act = $2', v_rows)
              using v_tbl, v_act;
            execute format('update %I set act = $2 where side = ''fees'' and tbl = $1 and act = $3', v_rows)
              using v_tbl, v_act, v_done_act;
          end;
          v_written := v_written || jsonb_build_object(v_tbl,
            coalesce(v_written->v_tbl, '{}'::jsonb) || jsonb_build_object(v_done_act, n));
        end loop;
      end loop;

      -- The references written last.
      foreach v_lcol in array c_late loop
        v_tbl := pg_catalog.split_part(v_lcol, '.', 1);
        v_col := pg_catalog.split_part(v_lcol, '.', 2);
        v_pk := null;
        execute format('select pk_cols from %I where tbl = $1', v_meta) into v_pk using v_tbl;
        continue when v_pk is null;
        v_join := (select string_agg(format('fc__t.%1$I = fc__x.%1$I', c), ' and ') from unnest(v_pk) c);
        v_sql := format('update public.%1$I fc__t set %2$I = fc__x.%2$I
                           from %3$I fc__r cross join lateral pg_catalog.jsonb_populate_record(null::public.%1$I, fc__r.j) fc__x
                          where fc__r.side = ''fees'' and fc__r.tbl = $1 and fc__r.act in (''insert'', ''update'')
                            and fc__t.%2$I is distinct from fc__x.%2$I and %4$s', v_tbl, v_col, v_rows, v_join);
        begin
          execute v_sql using v_tbl;
          get diagnostics n = row_count;
        exception when others then
          n := 0;
          for g in execute format($q$select pk from %I where side = 'fees' and tbl = $1 and act in ('insert', 'update') order by pk$q$, v_rows)
            using v_tbl
          loop
            begin
              execute v_sql || ' and fc__r.pk = $2' using v_tbl, g.pk;
              get diagnostics v_progress = row_count;
              n := n + v_progress;
            exception when others then
              get stacked diagnostics v_last_err = message_text;
              v_problems := v_problems || jsonb_build_object('late',
                format('%s %s: %s was left as it was (%s)', v_tbl, g.pk, v_col, v_last_err));
            end;
          end loop;
        end;
        if n > 0 then
          v_written := v_written || jsonb_build_object(v_tbl,
            coalesce(v_written->v_tbl, '{}'::jsonb) || jsonb_build_object(v_col || ' set', n));
        end if;
      end loop;

      for h in select x.t, x.name, x.mode from pg_catalog.jsonb_to_recordset(v_trg) as x(t text, name text, mode text) loop
        execute format('alter table public.%I %s trigger %I', h.t,
                       case h.mode when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end, h.name);
      end loop;

      if p_mode = 'apply' then
        execute format($q$insert into vppsone.fees_copy_test_ids (table_name, row_pk, first_run)
                           select tbl, pk, $1 from %I where side = 'fees' and is_test
                           on conflict (table_name, row_pk) do nothing$q$, v_rows)
          using v_run;
        execute format($q$insert into vppsone.fees_copy_nulled_refs (table_name, row_pk, column_name, fees_value, first_run, last_run)
                           select r.tbl, r.pk, x.key, x.value, $1, $1
                             from %I r cross join lateral pg_catalog.jsonb_each_text(r.nulled) x
                            where r.side = 'fees' and r.nulled is not null and r.act in ('insert', 'update', 'same')
                           on conflict (table_name, row_pk, column_name)
                           do update set fees_value = excluded.fees_value, last_run = excluded.last_run$q$, v_rows)
          using v_run;
        perform public.queue_workbook_materialized_view_refresh();
      end if;
    end if;

    ---------------------------------------------------------------- report
    execute format($q$select coalesce(pg_catalog.jsonb_object_agg(tbl, c), '{}'::jsonb) from (
                         select tbl, pg_catalog.jsonb_object_agg(k, n) as c from (
                           select tbl, case
                                    when side = 'fees' and act = 'test' then 'Fees TEST rows, not copied'
                                    when side = 'one' and act = 'test' then 'One TEST rows, left alone'
                                    when side = 'one' and act = 'extra' then 'only in One'
                                    when side = 'one' and act = 'one owned' then 'One''s own'
                                    when side = 'fees' and act = 'one owned' then 'Fees value not copied (One''s own)'
                                    when side = 'fees' then coalesce(act, 'unsorted')
                                  end as k, count(*) as n
                             from %I group by 1, 2) a
                          where k is not null group by tbl) b$q$, v_rows)
      into v_counts;
    execute format($q$select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table', tbl, 'id', pk, 'why', why)
                                                           order by tbl, pk), '[]'::jsonb)
                        from (select tbl, pk, why from %I where side = 'fees' and act = 'wait' order by tbl, pk limit 200) w$q$, v_rows)
      into v_wait;
    execute format($q$select coalesce(pg_catalog.jsonb_object_agg(tbl, x), '{}'::jsonb) from (
                         select tbl, pg_catalog.jsonb_build_object('count', count(*), 'ids', (array_agg(pk order by pk))[1:20]) as x
                           from %I where side = 'one' and act = 'extra' group by tbl) y$q$, v_rows)
      into v_extra;
    execute format($q$select coalesce(pg_catalog.jsonb_object_agg(k, v), '{}'::jsonb) from (
                         select r.tbl || '.' || x.key as k,
                                pg_catalog.jsonb_build_object('rows', count(*), 'missing', array_agg(distinct x.value)) as v
                           from %I r cross join lateral pg_catalog.jsonb_each_text(r.nulled) x
                          where r.side = 'fees' and r.nulled is not null group by 1) y$q$, v_rows)
      into v_nulled;
    execute format($q$select coalesce(pg_catalog.jsonb_object_agg(tbl, c), '{}'::jsonb) from (
                         select tbl, pg_catalog.jsonb_object_agg(k, n) as c from (
                           select f.tbl, x.key as k, count(*) as n
                             from %1$I f
                             join %1$I o on o.side = 'one' and o.tbl = f.tbl and o.pk = f.pk
                             cross join lateral pg_catalog.jsonb_each(f.j) x
                            where f.side = 'fees' and f.act = 'update' and (o.j->x.key) is distinct from x.value
                            group by 1, 2) a group by tbl) b$q$, v_rows)
      into v_diffcols;
    v_report := jsonb_build_object(
      'tables', v_tables || v_counts,
      'rules', v_rules,
      'collisions', jsonb_build_object('count', v_collisions, 'rows', v_coll),
      'waiting', v_wait,
      'only_in_one', v_extra,
      'staff_not_in_one', v_nulled,
      'changed_columns', v_diffcols,
      'written', v_written,
      'order', to_jsonb(v_order));

    if v_refused then
      v_status := 'refused';
    elsif p_mode = 'plan' then
      v_status := 'planned';
    elsif p_mode = 'apply' then
      v_status := 'applied';
    else
      raise exception using errcode = 'VPPRH', message = 'rehearsed';
    end if;
  exception
    when sqlstate 'VPPRH' then
      v_status := 'rehearsed';
    when sqlstate 'VPPCR' then
      v_status := 'refused';
    when others then
      get stacked diagnostics v_err = message_text, v_ctx = pg_exception_context;
      v_status := 'failed';
  end;

  begin
    perform extensions.dblink_exec('fees_copy', 'rollback');
  exception when others then
    null;
  end;
  begin
    perform vppsone.fees_copy_close();
  exception when others then
    null;
  end;

  v_report := coalesce(v_report, '{}'::jsonb)
    || jsonb_build_object('run', v_run, 'mode', p_mode, 'status', v_status, 'problems', v_problems);
  if v_err is not null then
    v_report := v_report || jsonb_build_object('error', v_err, 'where', v_ctx);
  end if;
  update vppsone.fees_copy_runs
     set finished_at = clock_timestamp(), status = v_status, report = v_report, error = v_err
   where id = v_run;
  return v_report;
end
$fn$;

comment on function vppsone.fees_copy_run(text) is
  'D-644: copy the Fees app''s data into One (plan | rehearse | apply). See the header of 20261116041000_fees_copy_run.sql.';

create or replace function vppsone.fees_copy_audit(p_max integer default 100000)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '20min'
set lock_timeout = '30s'
as $fn$
declare
  c_skip constant text[] := array['users', 'user_activity_events', 'staff_push_subscriptions',
    'office_sync_events', 'backup_runs', 'workbook_materialized_view_refresh_queue', 'online_payment_audit',
    'notion_sync_log', 'session_reconcile_log', 'setup_progress', 'whatsapp_number_health'];
  c_test_re constant text := '^(test|uat|demo)-[0-9]{4}-[0-9]{2}$';
  c_page constant integer := 5000;
  v_run bigint;
  v_buf text;
  v_after_at timestamptz;
  v_after_id uuid;
  v_page integer := 0;
  v_got bigint;
  v_new bigint;
  v_seen bigint := 0;
  v_copied bigint := 0;
  v_done boolean := false;
  v_status text := 'running';
  v_err text;
  v_report jsonb;
begin
  insert into vppsone.fees_copy_runs (mode) values ('audit') returning id into v_run;
  begin
    if exists (select 1 from vppsone.fees_copy_settings s where s.retired_at is not null) then
      raise exception using errcode = 'VPPCR', message = 'The copy is retired: One keeps its own records now.';
    end if;
    if not pg_try_advisory_xact_lock(hashtext('vppsone.fees_copy_run')) then
      raise exception using errcode = 'VPPCR', message = 'Another copy is running.';
    end if;
    select s.after_created_at, s.after_id into v_after_at, v_after_id
      from vppsone.fees_copy_audit_state s where s.id for update;

    perform set_config('timezone', 'UTC', true);
    perform vppsone.fees_copy_open();
    perform extensions.dblink_exec('fees_copy', 'rollback');
    perform extensions.dblink_exec('fees_copy', 'set timezone to ''UTC''');

    v_buf := format('fca%s', v_run);
    execute format('create temp table %I (page integer not null, j jsonb not null)', v_buf);
    while v_seen < p_max loop
      v_page := v_page + 1;
      execute format('insert into %I (page, j) select $1, f.j from extensions.dblink(''fees_copy'', $2) as f(j jsonb)', v_buf)
        using v_page, format(
          'select pg_catalog.to_jsonb(a) from public.audit_logs a where (a.created_at, a.id) > (%L::timestamptz, %L::uuid)
            order by a.created_at, a.id limit %s',
          coalesce(v_after_at, '-infinity'::timestamptz), coalesce(v_after_id, '00000000-0000-0000-0000-000000000000'::uuid), c_page);
      get diagnostics v_got = row_count;
      if v_got = 0 then
        v_done := true;
        exit;
      end if;
      v_seen := v_seen + v_got;
      -- A staff account One lacks becomes null; a row about TEST data, or about
      -- a table the copy leaves alone, stays in Fees.
      execute format($q$insert into public.audit_logs (id, table_name, record_id, action, before_data, after_data, changed_by, created_at)
                         select x.id, x.table_name, x.record_id, x.action, x.before_data, x.after_data,
                                case when x.changed_by is not null
                                      and exists (select 1 from auth.users u where u.id = x.changed_by) then x.changed_by end,
                                x.created_at
                           from %I b cross join lateral pg_catalog.jsonb_populate_record(null::public.audit_logs, b.j) x
                          where b.page = $1
                            and x.table_name <> all($2)
                            and not exists (select 1 from vppsone.fees_copy_test_ids t
                                             where t.table_name = x.table_name and t.row_pk = x.record_id::text)
                            and pg_catalog.lower(coalesce(x.after_data->>'session_label', x.before_data->>'session_label', '')) !~ $3
                         on conflict (id) do nothing$q$, v_buf)
        using v_page, c_skip, c_test_re;
      get diagnostics v_new = row_count;
      v_copied := v_copied + v_new;
      execute format($q$select (j->>'created_at')::timestamptz, (j->>'id')::uuid from %I where page = $1
                         order by (j->>'created_at')::timestamptz desc, (j->>'id')::uuid desc limit 1$q$, v_buf)
        into v_after_at, v_after_id using v_page;
      if v_got < c_page then
        v_done := true;
        exit;
      end if;
    end loop;
    update vppsone.fees_copy_audit_state
       set after_created_at = v_after_at, after_id = v_after_id, copied = copied + v_copied, updated_at = now()
     where id;
    v_status := 'applied';
  exception
    when sqlstate 'VPPCR' then
      v_status := 'refused';
      v_err := sqlerrm;
    when others then
      v_status := 'failed';
      v_err := sqlerrm;
  end;

  begin
    perform extensions.dblink_exec('fees_copy', 'rollback');
  exception when others then
    null;
  end;
  begin
    perform vppsone.fees_copy_close();
  exception when others then
    null;
  end;

  v_report := jsonb_build_object('run', v_run, 'mode', 'audit', 'status', v_status, 'seen', v_seen,
                                 'copied', v_copied, 'caught_up', v_done, 'after', v_after_at, 'error', v_err);
  update vppsone.fees_copy_runs
     set finished_at = clock_timestamp(), status = v_status, report = v_report, error = v_err
   where id = v_run;
  return v_report;
end
$fn$;

comment on function vppsone.fees_copy_audit(integer) is
  'D-644: bring the Fees app''s audit_logs into One, insert-only, from where the last call stopped.';

revoke all on function vppsone.fees_copy_run(text) from public, anon, authenticated, service_role;
revoke all on function vppsone.fees_copy_audit(integer) from public, anon, authenticated, service_role;
revoke all on function vppsone.fees_copy_pk_expr(text, text[]) from public, anon, authenticated, service_role;
revoke all on function vppsone.fees_copy_set(jsonb, text, jsonb) from public, anon, authenticated, service_role;
