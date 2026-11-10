-- APInex's free models in the AI helper (D-567).
--
-- One more free provider, `apinex-free`: an OpenAI-shaped gateway whose
-- `free/...` models cost nothing. Like the other free providers it only ever
-- sees the open tasks, or a test account's text; never a photo.
--
--  * assist_log.provider may now say `apinex-free`. The model column already
--    names which of APInex's models wrote the draft (`free/glm-5.3`).
--  * assist_settings.free_check keeps the last "Check free models" run from
--    Settings -> AI in One -> Cost: which free models APInex listed, and for
--    each one whether it wrote a usable notice and cover plan, and how fast.
--    Only model names, times, a fixed problem word and an HTTP status; never
--    an answer, a prompt or a key. The helper uses it to skip models that did
--    not answer. Null until the first check.
--
-- Rollback: alter table vppsone.assist_settings drop column free_check;
--           alter table vppsone.assist_log drop constraint assist_log_provider_known;
--           alter table vppsone.assist_log add constraint assist_log_provider_known
--             check (provider in ('nvidia-free', 'openrouter-free', 'gemini-free', 'anthropic', 'openai', 'gemini-paid'));
--           (after deleting or nulling any rows whose provider is 'apinex-free')
--
-- Applied to One (wtgxcptmucjerhufzjcf) on 10 Nov 2026; the file carries the version the database recorded.

alter table vppsone.assist_log drop constraint if exists assist_log_provider_known;
alter table vppsone.assist_log
  add constraint assist_log_provider_known
  check (provider in ('nvidia-free', 'openrouter-free', 'gemini-free', 'apinex-free', 'anthropic', 'openai', 'gemini-paid'));

alter table vppsone.assist_settings
  add column if not exists free_check jsonb
  constraint assist_settings_free_check_shape
  check (free_check is null or (jsonb_typeof(free_check) = 'object' and pg_column_size(free_check) < 65536));

comment on column vppsone.assist_settings.free_check is
  'The last check of APInex''s free models (D-567): {at, blocked, models[], results[{model, probe, ok, ms, problem?, httpStatus?}]}. No answer, prompt or key.';
