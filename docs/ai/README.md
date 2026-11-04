# VPPS One built-in AI

The built-in pilot is separate from the AI assistant connection and the original Assist helper. Staff use the usual Marks, Substitutions and Teacher Today screens. No staff member configures or sees a provider key.

A phone receives a signed upload token for a job-owned object in private Storage. The parse route rechecks the actor, action, TEST session and object path, decodes bounded media, then sends only extraction input to the provider. The result must satisfy a structured schema and Zod. The app maps names, roll numbers, staff initials, dates, papers, classes and periods to its current records. App code alone can invoke the native attendance, notes, marks or cover command. Voice always shows the transcript; writes require a tap. Photo marks require row review and save an ordinary marks draft. Valid cover photo rows may auto-apply in an explicitly enabled rehearsal; invalid rows are held for review.

Every action has one private `vppsone.ai_jobs` row. It records provider/model, reported version and tokens, estimated rupee cost, original extraction and applied data. Provider retries are included in estimates when usage is available. A 90-day cleanup removes private inputs and detailed payloads; aggregate counters survive. Settings → Built-in AI reports monthly usage, free versus paid share, edit rate and recent failures. The server reserves the per-person daily quota transactionally in school time; zero pauses new requests.

## Server environment

| Variable | Use |
| --- | --- |
| `VPPSONE_BUILTIN_AI_TEST` | `1` only in a confined, staff-only TEST rehearsal. Production refuses it. |
| `VPPSONE_BUILTIN_AI_COVER_AUTO_TEST` | `1` only for a fictional cover auto-apply rehearsal; otherwise cover photos produce review drafts. |
| `GEMINI_API_KEY_FREE` | First provider for fictional photo and voice inputs. |
| `GEMINI_API_KEY` | Existing Gemini paid-fallback slot. Optional `GEMINI_API_KEY_PAID` overrides it. |
| `ANTHROPIC_API_KEY` | Claude image extraction, and Claude understanding after voice transcription. |
| `OPEN_AI_API_KEY` | Vercel's exact OpenAI transcription key name. `OPENAI_API_KEY` is a compatibility alias. |
| `GEMINI_MODEL`, `GEMINI_MODEL_VISION`, `GEMINI_MODEL_PAID` | Default `gemini-3.5-flash-lite`. The paid slot also honours legacy `GEMINI_MODEL_FALLBACK`. |
| `VPPSONE_CLAUDE_IMAGE_MODEL`, `VPPSONE_CLAUDE_VOICE_MODEL` | Default `claude-sonnet-5-5` and `claude-haiku-5-5`. |
| `VPPSONE_OPENAI_TRANSCRIPTION_MODEL` | Default `gpt-transcribe`. |
| `GEMINI_THINKING_LEVEL`, `GEMINI_THINKING_BUDGET` | Low/minimal reasoning; the legacy Gemini 2.5 budget is capped. |
| `GEMINI_INR_PER_USD` | Accounting rate for estimated costs, default 90. It is configurable and does not use a live exchange-rate feed. |

Images route Gemini Free → Claude Sonnet → Gemini Paid. Voice routes Gemini Free → OpenAI transcription and Claude → Gemini Paid. Unconfigured stages are skipped. Provider HTTP quota, permission, timeout and bad structured responses can advance the chain; the SDKs do not execute One tools. Android WebM/Opus and Safari audio-only MP4/M4A go through signed uploads, as does fixture WAV. Recording stops after 60 seconds on the phone.

[Gemini audio formats](https://ai.google.dev/gemini-api/docs/audio) · [Gemini API terms](https://ai.google.dev/gemini-api/terms) · [Claude models](https://platform.claude.com/docs/en/models/overview) · [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) · [OpenAI transcription formats](https://developers.openai.com/api/docs/guides/speech-to-text)

## Fixtures

From this checkout:

```powershell
npm.cmd run ai:fixtures -- "D:\Codex\cowork\VPPS One AI\New synthetic pack"
npm.cmd run ai:voice-fixtures -- "D:\Codex\cowork\VPPS One AI\New synthetic pack"
npm.cmd run ai:eval -- --validate-only "D:\Codex\cowork\VPPS One AI\New synthetic pack"
```

The photo generator makes 20 examples per photo task, including rotated register photos, missing pupils, half marks and source dates. The Windows audio generator adds six fictional utterances using offline SAPI; the available voices here are English, so these do not measure Hindi/Hinglish recognition.

Keep real fixtures outside Git. Hand-copy the fictional rows onto usual classroom paper, or use separately approved de-identified originals; write exact row-order answers and check the date as written. Record approved Hindi, English and mixed clips with fictional names. Use the generated `manifest.json` as the format: each case names its action, relative media paths, allowed context and expected structured result. For voice, include `transcript`, `intent`, `unclear` and whichever extracted fields you want to score. Mark reviewed data `school-approved-deidentified`. Read the source [plan](../plans/2026-11-04-built-in-gemini.md) for the marks timing and accuracy gates.

With provider evaluation explicitly enabled in the local environment, use `--run-synthetic` for generated inputs and `--run` for reviewed real samples. Add an optional stage name: `gemini-free`, `anthropic`, `openai-claude` or `gemini-paid`. Each selected stage is scored independently, with field accuracy, model/version and latency. The paid evaluation switch is `GEMINI_EVAL_APPROVED=1`. The real benchmark skips the free tier and rejects synthetic manifests. Use the focused provider tests to force a 429 without spending a request.

## Database and release

Apply the ordered AI migrations only to a verified, disposable development Supabase project. One's only visible hosted project, despite its legacy name, has a production marker. There is no hosted schema change or activation in this code delivery. Keep the Vercel flag off there; the absence of an AI migration is handled gracefully on the Settings page and retention job.

See [PROGRESS.md](PROGRESS.md) and [DECISIONS.md](DECISIONS.md) for verification and release limits.
