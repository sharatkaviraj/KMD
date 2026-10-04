-- P11 follow-up: archived rows travel as text, never as parsed numbers.
--
-- A JSON parser in the app turns the numeric 0.50 into 0.5, and a reloaded
-- table then digests differently from the one archived — a restore drill
-- failing on a sound archive. So the export hands its rows over as the text
-- Postgres wrote, the file is that text byte for byte, and the drill takes
-- text and parses it in Postgres.

create or replace function vppsone.archive_table_export(p_table text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count bigint;
  v_md5 text;
begin
  if p_table not in (select vppsone.archive_tables()) then
    raise exception 'not an archived table: %', p_table;
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb), count(*), '
    || 'md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')) from vppsone.%I t',
    p_table
  ) into v_rows, v_count, v_md5;
  -- `rows` is a string: the caller writes it to the file without parsing it.
  return jsonb_build_object('rows', v_rows::text, 'count', v_count, 'md5', v_md5);
end;
$$;

drop function vppsone.restore_drill_table(text, jsonb);

create or replace function vppsone.restore_drill_table(p_table text, p_rows text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_md5 text;
begin
  if p_table not in (select vppsone.archive_tables()) then
    raise exception 'not an archived table: %', p_table;
  end if;
  -- Same columns and types as the table, none of its constraints, triggers or
  -- defaults; gone at the end of this transaction.
  execute 'drop table if exists pg_temp.restore_drill';
  execute format('create temp table restore_drill (like vppsone.%I) on commit drop', p_table);
  execute format(
    'insert into pg_temp.restore_drill select * from jsonb_populate_recordset(null::vppsone.%I, $1::jsonb)',
    p_table
  ) using p_rows;
  execute
    'select count(*), md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')) from pg_temp.restore_drill t'
    into v_count, v_md5;
  execute 'drop table pg_temp.restore_drill';
  return jsonb_build_object('rows', v_count, 'md5', v_md5);
end;
$$;

revoke all on function vppsone.restore_drill_table(text, text) from public, anon, authenticated;
grant execute on function vppsone.restore_drill_table(text, text) to service_role;
