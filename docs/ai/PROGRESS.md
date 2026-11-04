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

A 390 px Chrome fixture exercised all three interfaces with mocked Storage, capture and API responses: marks review and save, cover result and Undo, Bolo transcript and explicit Save. The offline evaluator includes 20 marks lists, 20 substitution slips and six synthetic voice clips. No hosted schema, credential, real school data or outbound provider state has changed. Hosted phone acceptance and real handwriting/voice scores remain open because no separate development Supabase or nonproduction provider keys were available.

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

**Provider stages that failed in production** (each fell through to the next stage; the current code records no HTTP status for them):

- Gemini Free: unavailable for images and audio. Only affects TEST-session jobs; real sessions never use it.
- OpenAI `gpt-transcribe`: unavailable for a WAV clip. Real-session voice currently succeeds through Gemini Paid. The model ID is current ([model page](https://developers.openai.com/api/docs/models/gpt-transcribe)), so check the key's project access and the request once a failure status is recorded.
- Gemini Paid answered audio and a cover photo, but a parallel session saw HTTP 400 on the marks-photo schema and is moving the request to `responseJsonSchema`. Real-session marks photos start at Claude.

**Not verified on production:** marks photo end to end (the admin account is not assigned to a paper; the parallel session exercised it with a QA teacher), physical Android/iPhone microphone capture, Hindi/Hinglish speech, and a real (non-fictional) handwriting accuracy set. Staff WhatsApp delivery stays off until the school turns on staff notices.

