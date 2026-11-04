-- Built-in AI: which key answered, and what each key last did (4 November 2026).
--
-- ai_jobs.key_type records how the answering key is paid for: the free AI
-- Studio tier, Google billing, or prepaid API credits (lib/ai/router.ts).
-- builtin_ai_provider_status keeps one row per key: working, out of quota
-- (with the time a free-tier daily quota resets, midnight Pacific), or
-- failing, with a fixed failure category and HTTP status only. Every server
-- instance reads it, so one exhausted free key is skipped everywhere.
-- builtin_ai_settings.last_smoke holds the admin key check's results.
-- Server only: RLS on, no browser grants.

alter table vppsone.ai_jobs add column key_type text check (key_type in ('free', 'paid', 'credits'));

create table vppsone.builtin_ai_provider_status (
  provider text primary key check (provider in ('gemini-free', 'gemini-paid', 'anthropic', 'openai')),
  state text not null check (state in ('ok', 'quota', 'failing')),
  problem text check (problem ~ '^[a-z_]{1,32}$'),
  http_status integer check (http_status between 100 and 599),
  model text check (char_length(model) <= 80),
  blocked_until timestamptz,
  checked_at timestamptz not null default now()
);
alter table vppsone.builtin_ai_provider_status enable row level security;
revoke all on vppsone.builtin_ai_provider_status from public, anon, authenticated;
grant select, insert, update on vppsone.builtin_ai_provider_status to service_role;

alter table vppsone.builtin_ai_settings add column last_smoke jsonb;
alter table vppsone.builtin_ai_settings add column last_smoke_at timestamptz;
