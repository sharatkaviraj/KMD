# VPPS One built-in AI

Built-in AI is separate from the AI assistant connection and the original Assist helper. Staff use the usual Marks, Substitutions and Teacher Today screens, and on a phone the "+" sheet's Quick substitute (Photo · Speak · Arrange) for anyone who may arrange cover. No staff member configures or sees a provider key. Since 4 November 2026 it runs in production for every member of staff whose permissions allow the action, in the session they are working in (`VPPSONE_BUILTIN_AI=live`).

A phone receives a signed upload token for a job-owned object in private Storage. The parse route rechecks the actor, action, session and object path, decodes bounded media, then sends only extraction input to the provider. The result must satisfy a structured schema and Zod. The app maps names, roll numbers, staff initials, dates, papers, classes and periods to its current records. App code alone can invoke the native attendance, notes, marks or cover command. Voice always shows the transcript; writes require a tap. Photo marks require row review and save an ordinary marks draft. Valid cover photo rows apply at once with a two-minute Undo, and their notices wait out that window; invalid, unclear or undated rows are held for review with suggestions.

Every action has one private `vppsone.ai_jobs` row. It records provider/model, reported version and tokens, estimated rupee cost, original extraction and applied data. Provider retries are included in estimates when usage is available. A 90-day cleanup removes private inputs and detailed payloads; aggregate counters survive. Settings → Built-in AI reports monthly usage, free versus paid share, edit rate and recent failures. The server reserves the per-person daily quota transactionally in school time; zero pauses new requests.

## Server environment

| Variable | Use |
| --- | --- |
| `VPPSONE_BUILTIN_AI` | The production switch. `live`: every permitted member of staff, in their own session. `test`: TEST sessions only (test accounts, or a real admin switched to TEST). Unset or anything else: off. A Preview or local server is never more than `test`. |
| `VPPSONE_BUILTIN_AI_COVER_AUTO` | Leave unset: valid cover-photo rows in a real session apply with a two-minute Undo. `0` makes every session review-only. |
| `VPPSONE_BUILTIN_AI_TEST` | `1` turns on `test` mode on a confined (Preview/local) deployment. Production ignores it. |
| `VPPSONE_BUILTIN_AI_COVER_AUTO_TEST` | `1` lets a TEST-session cover photo auto-apply; otherwise TEST cover photos produce review drafts. |
| `GEMINI_API_KEY_FREE` | First provider for TEST-session (fictional) photo and voice inputs only. Real-session jobs never use it: Google's unpaid terms forbid personal information. |
| `GEMINI_API_KEY` | Existing Gemini paid-fallback slot. Optional `GEMINI_API_KEY_PAID` overrides it. |
| `ANTHROPIC_API_KEY` | Claude image extraction, and Claude understanding after voice transcription. |
| `OPEN_AI_API_KEY` | Vercel's exact OpenAI transcription key name. `OPENAI_API_KEY` is a compatibility alias. |
| `GEMINI_MODEL`, `GEMINI_MODEL_VISION`, `GEMINI_MODEL_PAID` | Default `gemini-3.5-flash-lite`. The paid slot also honours legacy `GEMINI_MODEL_FALLBACK`. |
| `VPPSONE_CLAUDE_IMAGE_MODEL`, `VPPSONE_CLAUDE_VOICE_MODEL` | Default `claude-sonnet-5-5` and `claude-haiku-5-5`. |
| `VPPSONE_OPENAI_TRANSCRIPTION_MODEL` | Default `gpt-transcribe`. |
| `GEMINI_THINKING_LEVEL`, `GEMINI_THINKING_BUDGET` | Low/minimal reasoning; the legacy Gemini 2.5 budget is capped. |
| `GEMINI_INR_PER_USD` | Accounting rate for estimated costs, default 90. It is configurable and does not use a live exchange-rate feed. |

Images route Gemini Free → Claude Sonnet → Gemini Paid. Voice routes Gemini Free → OpenAI transcription and Claude → Gemini Paid. Real-session jobs skip Gemini Free, so they start at Claude. Unconfigured stages are skipped. Provider HTTP quota, permission, timeout and bad structured responses can advance the chain; the SDKs do not execute One tools. Android WebM/Opus and Safari audio-only MP4/M4A go through signed uploads, as does fixture WAV. Recording stops after 60 seconds on the phone.

[Gemini audio formats](https://ai.google.dev/gemini-api/docs/audio) · [Gemini API terms](https://ai.google.dev/gemini-api/terms) · [Claude models](https://platform.claude.com/docs/en/models/overview) · [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) · [OpenAI transcription formats](https://developers.openai.com/api/docs/guides/speech-to-text)

## Fixtures

From this checkout:

```powershell
npm.cmd run ai:fixtures -- "D:\Codex\cowork\VPPS One AI\New synthetic pack"
npm.cmd run ai:voice-fixtures -- "D:\Codex\cowork\VPPS One AI\New synthetic pack"
npm.cmd run ai:eval -- --validate-only "D:\Codex\cowork\VPPS One AI\New synthetic pack"
```

The photo generator makes 20 examples per photo task, including rotated register photos, missing pupils, half marks and source dates. The Windows audio generator adds six fictional utterances using offline SAPI; the available voices here are English, so these do not measure Hindi/Hinglish recognition.

Keep real fixtures outside Git. Hand-copy the fictional rows onto usual classroom paper, or use separately approved de-identified originals; write exact row-order answers and check the date as written. Record approved Hindi, English and mixed clips with fictional names. Use the generated `manifest.json` as the format: each case names its action, relative media paths, allowed context and expected structured result. For voice, include the role’s declared `context.actions` and the expected `transcript`, `intent`, `unclear` and whichever extracted fields you want to score. Mark reviewed data `school-approved-deidentified`. Read the source [plan](../plans/2026-11-04-built-in-gemini.md) for the marks timing and accuracy gates.

With provider evaluation explicitly enabled in the local environment, use `--run-synthetic` for generated inputs and `--run` for reviewed real samples. Add an optional stage name: `gemini-free`, `anthropic`, `openai-claude` or `gemini-paid`. Each selected stage is scored independently, with field accuracy, model/version and latency. The paid evaluation switch is `GEMINI_EVAL_APPROVED=1`. The real benchmark skips the free tier and rejects synthetic manifests. Use the focused provider tests to force a 429 without spending a request.

## Database and release

One has one database, `wtgxcptmucjerhufzjcf`, and it is production (D-346). The four AI migrations are applied there and the files carry the versions the database recorded: `20261104054116` built_in_ai_jobs, `20261104054119` ai_cover_photo, `20261104054126` builtin_ai_provider_usage and `20261104055339` builtin_ai_live. The last one lifts the pilot's TEST-only fence: a job belongs to the session the member of staff is working in, and a test account can still only reserve, apply or undo in a TEST session.

To switch it on or off: `vercel env add VPPSONE_BUILTIN_AI production` (value `live` or `test`), or `vercel env rm`, then redeploy. To pause new requests without a deploy, set the daily limit to 0 under Settings → Built-in AI.

The protected `codex/ai-test-preview` Vercel branch uses the same database and confines the pilot to `TEST-2026-27`. Keep its credentials scoped to the branch. For a cover auto-apply rehearsal, use a fictional substitute without contact information or consent, check that the pending notice is held, and use Undo. Check the transcript, student and roll number before confirming a voice update.

Cover notices queue in the ordinary staff outbox with the two-minute hold. They reach WhatsApp only when the school turns on staff notices (`STAFF_NOTICE_TRANSPORT=aisensy` and the `staff_notice_dispatch` flag); that switch is separate and covers every staff notice.

See [PROGRESS.md](PROGRESS.md) and [DECISIONS.md](DECISIONS.md) for verification and release limits.
