-- P12: prove, from the catalogue, that this app's work left the fee app's
-- contracts exactly as they were.
--
-- Prompt 8: "protect fee parity with source-boundary assertions … academic
-- changes cannot alter receipt/ledger paths, actor attribution, request-key
-- behaviour, reversals or fee automation. Do not call live fees to prove
-- noninterference. No migration modifies shared fee schemas/functions."
--
-- Read-only. Returns every function, trigger and index in `public` and
-- `private` with an md5 of its definition, so `verify:fee-parity` can compare
-- them with a committed baseline and name anything that moved. Reading a
-- definition is not reading fee data, and nothing here writes.

create or replace function vppsone.fee_contract_fingerprints()
returns table (kind text, name text, md5 text, definition text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(pg_get_functiondef(p.oid)), pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f'
  union all
  select 'trigger', n.nspname || '.' || c.relname || ':' || t.tgname,
         md5(pg_get_triggerdef(t.oid)), pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'index', i.schemaname || '.' || i.indexname, md5(i.indexdef), i.indexdef
  from pg_indexes i
  where i.schemaname = 'public'
  order by 1, 2;
$$;

comment on function vppsone.fee_contract_fingerprints is
  'Read-only catalogue fingerprints of the fee app''s functions, triggers and indexes, for verify:fee-parity. Writes nothing.';

revoke all on function vppsone.fee_contract_fingerprints() from public, anon, authenticated;
grant execute on function vppsone.fee_contract_fingerprints() to service_role;
