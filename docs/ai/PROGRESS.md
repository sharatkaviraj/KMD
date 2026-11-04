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

The initial delivery exercised all three interfaces at 390 px with mocked Storage, capture and API responses. The offline evaluator includes 20 marks lists, 20 substitution slips and six synthetic voice clips.

## Hosted TEST rehearsal · 4 November 2026

The existing One project recorded all four AI migrations listed in the README. The protected `codex/ai-test-preview` branch uses the Gemini paid fallback and the fictional `TEST-2026-27` rehearsal class. The 390 px Chromium run exercised the actual signed uploads, Gemini responses and app commands. Marks saved 17.5, AB and 9 as a draft. A substitution applied and Undo cancelled its held notice before any delivery attempt. Bolo captured and transcribed WebM audio, then saved the intended pupil absent and two pupils present after explicit confirmation. A prior synthetic utterance was transcribed with the wrong roll number, so the final test checked the exact student in the review and in the saved register. Physical phones and real handwriting and speech accuracy remain separate acceptance checks.
