-- Which provider wrote each AI helper draft (D-496).
--
-- The free models (NVIDIA, OpenRouter, Gemini Free) now write the open tasks
-- for everyone, and every text task for a test account. `model` alone cannot
-- tell Gemini Free from Gemini Paid (both can run the same model), so each
-- row now names its provider, and Settings -> AI helper can show how many
-- drafts were free and roughly what they would have cost on the paid models.
--
-- Rows written before this migration have no provider; the page counts them
-- as paid. Still no prompt and no answer: the log stays metadata (D-324).
--
-- Rollback: drop function vppsone.assist_usage_by_provider(timestamptz);
--           alter table vppsone.assist_log drop column provider;

alter table vppsone.assist_log
  add column if not exists provider text
  constraint assist_log_provider_known
  check (provider in ('nvidia-free', 'openrouter-free', 'gemini-free', 'anthropic', 'openai', 'gemini-paid'));

comment on column vppsone.assist_log.provider is
  'The stage that wrote the draft, or the last one tried when none did (D-496). Null on rows written before 7 Nov 2026.';

-- Settings -> AI helper: drafts and tokens per provider and task since a moment.
create or replace function vppsone.assist_usage_by_provider(p_since timestamptz)
returns table (
  provider text,
  task text,
  drafts integer,
  input_tokens bigint,
  output_tokens bigint,
  cost_usd numeric
)
language sql
stable
set search_path = ''
as $$
  select
    l.provider,
    l.task,
    count(*)::integer,
    coalesce(sum(l.input_tokens), 0)::bigint,
    coalesce(sum(l.output_tokens), 0)::bigint,
    coalesce(sum(l.cost_usd), 0)
  from vppsone.assist_log l
  where l.created_at >= p_since and l.outcome = 'drafted'
  group by l.provider, l.task;
$$;

revoke all on function vppsone.assist_usage_by_provider(timestamptz) from public, anon, authenticated;
grant execute on function vppsone.assist_usage_by_provider(timestamptz) to service_role;
