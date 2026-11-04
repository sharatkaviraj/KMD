# Built-in AI progress

| Step | State | Evidence |
| --- | --- | --- |
| 0 · Discover | Verified | Names-only Vercel CLI, official provider docs, One deployment marker and TEST timetable counts. No hosted dev target. |
| 1 · Shared AI | Implemented; local checks passed | Real SDK mock forced a 429 and reached Claude; both ordered SQL migrations verified locally for private access, audio paths, quota and usage. |
| 2 · Marks photo | Implemented | Existing English/Hindi phone-width review, provider-router integration, deterministic range/identity checks, and native marks command replay tests. |
| 3 · Substitution photo | Implemented; local checks passed | Date and lesson validation, native cover suggestions, opt-in auto-apply, two-minute notice hold/Undo; isolated PostgreSQL covered replay, conflict rollback and delayed claim. |
| 4 · Voice | Implemented; local checks passed | Role-filtered commands, scoped absence and availability answers, native writes after confirmation, mocked WebM/MP4 capture and 60-second cutoff. Physical-device/provider verification remains open. |
| 5 · Admin AI | Implemented | Monthly rupee estimates and provider share, edit rate, recent failures, and adjustable per-staff daily quota. The usage RPC was verified in isolated PostgreSQL. |
| 6 · Live | **Live for staff since 4 Nov 2026** (`VPPSONE_BUILTIN_AI=live`) | #189 merged as `39c4526a`; deployed with the switch at `test` (`dpl_AXF382EU9jcGRXe7P5bVdPhjXHq4`), then `live` (`dpl_A4kQZT45891zv2SePLpJCaFkTrzv`, aliased to one.vpps.co.in). Migration `20261104055339_builtin_ai_live` applied on wtgx (MD5 of the stored statement equals the file); a rolled-back probe reserved a TEST job and a real-session job and refused a test account in the real session. Full suite 20,563 passed; all 27 CI checks green. See the production evidence below. |

The initial delivery exercised all three interfaces at 390 px with mocked Storage, capture and API responses. The offline evaluator includes 20 marks lists, 20 substitution slips and six synthetic voice clips.

## Hosted TEST rehearsal · 4 November 2026

The existing One project recorded all four AI migrations listed in the README. The protected `codex/ai-test-preview` branch uses the Gemini paid fallback and the fictional `TEST-2026-27` rehearsal class. The 390 px Chromium run exercised the actual signed uploads, Gemini responses and app commands. Marks saved 17.5, AB and 9 as a draft. A substitution applied and Undo cancelled its held notice before any delivery attempt. Bolo captured and transcribed WebM audio, then saved the intended pupil absent and two pupils present after explicit confirmation. A prior synthetic utterance was transcribed with the wrong roll number, so the final test checked the exact student in the review and in the saved register. Physical phones and real handwriting and speech accuracy remain separate acceptance checks.

## Production evidence — 4 November 2026

Admin account in Chrome on one.vpps.co.in; fictional fixtures from `npm run ai:fixtures` / `ai:voice-fixtures`.

| Check | Mode, session | Result |
| --- | --- | --- |
| AI routes while off | off, 2026-27 | 404 for all three |
| Settings badge | `test` → `live` | "TEST only" → "On for staff" |
| Real session hidden in `test` | `test`, 2026-27 | panels absent; cover and voice routes 404 |
| Cover photo, wrong date (slip 5 Oct, page 4 Nov) | `test`, TEST-2026-27 | Claude Sonnet 5.5, 5.4 s, ₹0.48: no rows (date guard) |
| Cover photo, slip's own date | `test`, TEST-2026-27 | Claude Sonnet 5.5, 4.5 s, ₹0.71: 5/5 rows read; all held for Review (fictional initials); 0 duties written |
| Bolo "Who is free for period five today?" | `test`, TEST-2026-27 | transcript exact; read-only answer; no Save offered; 7.2 s round trip |
| Same question | `live`, 2026-27 | Gemini Free skipped; read-only answer from the real timetable; 3.6 s parse, ₹0.03; 0 AI-written duties in 2026-27 |

During the initial production rollout, the provider router recovered from the following failures. The release adds sanitized HTTP status codes for diagnosing future failures.

- Gemini Free: unavailable for images and audio. Only affects TEST-session jobs; real sessions never use it.
- OpenAI `gpt-transcribe`: unavailable for a WAV clip. Real-session voice currently succeeds through Gemini Paid. The model ID is current ([model page](https://developers.openai.com/api/docs/models/gpt-transcribe)), so check the key's project access and the request once a failure status is recorded.
- Gemini Paid answered audio and a cover photo. The hosted marks rehearsal originally received HTTP 400. It passed after moving the request to `responseJsonSchema`. Real-session marks photos start at Claude.

**Not verified on production:** marks photo end to end (the admin account is not assigned to a paper; the parallel session exercised it with a QA teacher), physical Android/iPhone microphone capture, Hindi/Hinglish speech, and a real (non-fictional) handwriting accuracy set. Staff WhatsApp delivery stays off until the school turns on staff notices.

## Production key check — 4 November 2026, 15:15 IST

Settings → Built-in AI → Check keys now on one.vpps.co.in: the same probes as `npm run ai:smoke`, run on the server with the production environment values (the report is stored in `builtin_ai_settings.last_smoke`; no key left the server).

| Key | Model | Text | Image or audio |
| --- | --- | --- | --- |
| Gemini Free | gemini-3.8-flash | 403, billing | 403, billing |
| Gemini Free | gemini-3.6-flash | 403, billing | 403, billing |
| Gemini Free | gemini-3.5-flash-lite | 403, billing | 403, billing |
| Gemini Free | gemini-3.1-flash-lite | 403, billing | 403, billing |
| Gemini Free | gemini-2.5-flash | 404, model | 404, model |
| Gemini Paid | gemini-3.5-flash-lite | ok, 1.5 s | ok, 1.6 s, counted 3 of 3 |
| Claude | claude-sonnet-5-5 | ok, 3.5 s | — |
| Claude | claude-haiku-5-5 | ok, 2.1 s | — |
| OpenAI | gpt-transcribe | — | ok, 1.5 s (audio) |

- **Free key: no model works.** Google refuses every current Flash model with 403 and a billing reason, and 2.5 Flash with 404 (closed to new users). The key has to come from an AI Studio project that is on the free tier; until it does, the router skips it for 10 minutes after each failure. Real records never use it (D-401).
- **Model:** `GEMINI_MODEL=gemini-3.5-flash-lite` (D-415).
- **Eval:** there is no `tests/ai-fixtures` directory, so `npm run ai:eval` was not run and there are no eval scores. The live checks used the fictional fixtures from `npm run ai:fixtures` and `ai:voice-fixtures`.
- **Bolo, before the fix** (TEST-2026-27, admin account, saved clip "Maya test madam will be absent tomorrow"): exact transcript, `teacher_absence`, Test teacher Maya, 5 Nov. The round trip took 26.6 s: OpenAI transcribed the clip, Claude Haiku timed out at 18 s, and Gemini Paid answered. Cause and fix: D-414.

