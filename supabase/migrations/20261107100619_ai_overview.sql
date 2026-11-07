-- Settings -> AI helper: one page for every AI job in One (D-501).
--
-- The written drafts (`assist_log`) and the photo and voice jobs (`ai_jobs`)
-- were counted on two different settings pages. This function returns both,
-- grouped small, so one page can show which model did which job, the route
-- each job took and what it cost:
--
--   helper   drafts per task, model, provider, outcome and decision
--   builtin  photo and voice jobs per action, model, provider and status
--   tries    every attempt a photo or voice job made, per provider (the fallbacks)
--   days     jobs per school day (IST)
--   recent   the last 14 jobs of either kind, newest first, with who asked
--
-- Metadata only, as before: no prompt, answer, transcript or photo. Test
-- accounts and TEST sessions are flagged so the page can say which jobs were
-- practice. Service role only, like the other usage functions.
--
-- Rollback: drop function vppsone.ai_overview(timestamptz);

create or replace function vppsone.ai_overview(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with helper as materialized (
  select
    l.created_at, l.task, l.model, l.provider, l.outcome, l.decision,
    coalesce(l.cost_usd, 0) as cost_usd,
    coalesce(l.input_tokens, 0) as input_tokens,
    coalesce(l.output_tokens, 0) as output_tokens,
    coalesce(sp.is_test_account, false) as test
  from vppsone.assist_log l
  left join vppsone.staff_profiles sp on sp.id = l.staff_profile_id
  where l.created_at >= p_since
), builtin as materialized (
  select
    j.created_at, j.action, j.model, j.provider, j.status, coalesce(j.edited, false) as edited,
    coalesce(j.estimated_cost_inr, 0) as cost_inr, j.attempts,
    (coalesce(j.session_label, '') ~ '^(TEST|UAT|DEMO)-' or coalesce(sp.is_test_account, false)) as test
  from vppsone.ai_jobs j
  left join vppsone.staff_profiles sp on sp.id = j.staff_profile_id
  where j.created_at >= p_since
), recent as (
  (
    select
      l.created_at as at, 'helper' as kind, l.task, l.model, l.provider, l.outcome,
      l.decision, null::text as status, coalesce(l.cost_usd, 0) as cost_usd, 0::numeric as cost_inr,
      '[]'::jsonb as attempts, coalesce(sp.is_test_account, false) as test, sp.display_name as who
    from vppsone.assist_log l
    left join vppsone.staff_profiles sp on sp.id = l.staff_profile_id
    order by l.created_at desc
    limit 14
  )
  union all
  (
    select
      j.created_at, 'builtin', j.action, j.model, j.provider, null, null, j.status, 0,
      coalesce(j.estimated_cost_inr, 0),
      case when jsonb_typeof(j.attempts) = 'array' then j.attempts else '[]'::jsonb end,
      (coalesce(j.session_label, '') ~ '^(TEST|UAT|DEMO)-' or coalesce(sp.is_test_account, false)),
      sp.display_name
    from vppsone.ai_jobs j
    left join vppsone.staff_profiles sp on sp.id = j.staff_profile_id
    order by j.created_at desc
    limit 14
  )
)
select jsonb_build_object(
  'helper', coalesce((
    select jsonb_agg(to_jsonb(g)) from (
      select task, model, provider, outcome, decision, test,
        count(*)::integer as n,
        sum(cost_usd) as cost_usd,
        sum(input_tokens)::bigint as input_tokens,
        sum(output_tokens)::bigint as output_tokens
      from helper
      group by task, model, provider, outcome, decision, test
    ) g
  ), '[]'::jsonb),
  'builtin', coalesce((
    select jsonb_agg(to_jsonb(g)) from (
      select action as task, model, provider, status, edited, test,
        count(*)::integer as n,
        sum(cost_inr) as cost_inr
      from builtin
      group by action, model, provider, status, edited, test
    ) g
  ), '[]'::jsonb),
  'tries', coalesce((
    select jsonb_agg(to_jsonb(g)) from (
      select b.action as task, a->>'provider' as provider, a->>'model' as model, a->>'outcome' as outcome,
        count(*)::integer as n,
        sum(case when jsonb_typeof(a->'costInr') = 'number' then (a->>'costInr')::numeric else 0 end) as cost_inr
      from builtin b
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(b.attempts) = 'array' then b.attempts else '[]'::jsonb end
      ) a
      where a->>'provider' is not null
      group by b.action, a->>'provider', a->>'model', a->>'outcome'
    ) g
  ), '[]'::jsonb),
  'days', coalesce((
    select jsonb_agg(to_jsonb(g) order by g.day) from (
      select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
        kind, provider, model, zero_cost, count(*)::integer as n
      from (
        select created_at, 'helper' as kind, provider, model, cost_usd = 0 as zero_cost from helper
        union all
        select created_at, 'builtin', provider, model, cost_inr = 0 from builtin
      ) x
      group by 1, kind, provider, model, zero_cost
    ) g
  ), '[]'::jsonb),
  'recent', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.at desc) from (
      select * from recent order by at desc limit 14
    ) r
  ), '[]'::jsonb)
);
$$;

revoke all on function vppsone.ai_overview(timestamptz) from public, anon, authenticated;
grant execute on function vppsone.ai_overview(timestamptz) to service_role;
