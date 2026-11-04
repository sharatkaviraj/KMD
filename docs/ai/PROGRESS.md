# Built-in AI progress

| Step | State | Evidence |
| --- | --- | --- |
| 0 · Discover | Verified | Names-only Vercel CLI, official provider docs, One deployment marker and TEST timetable counts. No hosted dev target. |
| 1 · Shared AI | Implemented; local checks passed | Real SDK mock forced a 429 and reached Claude; both ordered SQL migrations verified locally for private access, audio paths, quota and usage. |
| 2 · Marks photo | Implemented | Existing English/Hindi phone-width review, provider-router integration, deterministic range/identity checks, and native marks command replay tests. |
| 3 · Substitution photo | Implemented; local checks passed | Date and lesson validation, native cover suggestions, opt-in auto-apply, two-minute notice hold/Undo; isolated PostgreSQL covered replay, conflict rollback and delayed claim. |
| 4 · Voice | Implemented; local checks passed | Role-filtered commands, scoped absence and availability answers, native writes after confirmation, mocked WebM/MP4 capture and 60-second cutoff. Physical-device/provider verification remains open. |
| 5 · Admin AI | Implemented | Monthly rupee estimates and provider share, edit rate, recent failures, and adjustable per-staff daily quota. The usage RPC was verified in isolated PostgreSQL. |
| 6 · Live | Code and database ready; switch pending deploy | Branch `feat/builtin-ai-live`. Migration `20261104055339_builtin_ai_live` applied on wtgx (MD5 of the stored statement equals the file); a rolled-back probe reserved a TEST job and a real-session job and refused a test account in the real session. Pilot migrations renamed to their recorded versions. Real-session jobs skip Gemini Free. Focused AI tests 51/51. |

A 390 px Chrome fixture exercised all three interfaces with mocked Storage, capture and API responses: marks review and save, cover result and Undo, Bolo transcript and explicit Save. The offline evaluator includes 20 marks lists, 20 substitution slips and six synthetic voice clips. No hosted schema, credential, real school data or outbound provider state has changed. Hosted phone acceptance and real handwriting/voice scores remain open because no separate development Supabase or nonproduction provider keys were available.
