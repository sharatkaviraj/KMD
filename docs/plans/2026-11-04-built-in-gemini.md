# VPPS One: built-in Gemini

Gemini reads a photo or an audio clip and returns a structured draft. VPPS One authenticates the staff member, verifies class/subject/roster and current rules, and writes through the ordinary app command. Provider output never carries authority, credentials, callable write tools or access to school records.

## Build and release order

1. **Foundation:** server-only Google GenAI, bounded structured extraction, private signed uploads, job audit/usage, a 50-job per-person limit per school day, 90-day cleanup, and an evaluation runner. This is separate from Assist and external AI connectors.
2. **Marks photo:** open the teacher's assigned paper, photograph up to four pages, check the editable transcription, resolve or explicitly skip every flagged row and save through the marks draft command. Match written roll and name independently against the roster. Respect the paper's existing max and increment, distinguish absence from blank, show missing students, and never save duplicates. Sending the paper to the exam office remains the existing separate action.
3. **Substitution photo:** verify the timetable and short names in the active session before enabling. Reuse VPPS One's existing substitution engine. Match the absent teacher, class and period; check the source date before automatic apply and send undated or ambiguous pages to review. Validate availability and double bookings again at commit. Auto-apply only valid rows after the accuracy/operational gate; suggest free teachers for other rows. The two-minute Undo window needs a cancellable outbox entry and an atomic dispatch claim, plus synthetic tests that prove Undo wins before the window expires. Test with outbound delivery disabled. Live WhatsApp delivery is a separate rollout decision.
4. **Bolo:** staff-only voice attendance first, then single marks, then substitutions. Expose only supported intents for the staff role. Show the transcript and require confirmation for each write; answer scoped read-only questions from checked school facts. WebM/Opus is documented by Gemini. Safari's MP4 container is different from raw AAC; verify the actual device clip and transcode if necessary before enabling. Capture stops at 60 seconds.
5. **Polish:** device-local offline queue with clear/remove and per-account isolation, admin usage and failures, edit rate (a proxy for accuracy), Hindi labels, and a newer vision model only if the private evaluation improves.

Later ideas: leave-note photos, attendance register catch-up, report-card remarks, translated notices, and an admin read-only school summary.

## Current implementation

The foundation and teacher Marks photo flow are implemented on the pilot branch. The photo entry point appears on a teacher's open, assigned paper only in the opted-in TEST session. The server checks the paper, revision and roster again on Save; it saves a marks draft, so the existing review and submit controls still govern sending the paper to the exam office. It uses the job ID as the ordinary marks command ID so a lost response can be retried safely.

Local evidence: isolated PostgreSQL migration, Storage policy and quota check; synthetic manifest validation; and 390 px Chrome checks in English and Hindi of upload preparation, a mismatched row, the missing-student list and a mocked save. The repository suite passed 20,416 tests (one skipped), the focused AI tests passed again after the final save-error handling change, and the final build and bundle budget check passed. The deployment trace includes the marks prompt. No hosted migration, provider call, or cutover was performed. The 95% and one-minute targets remain open until the approved private set and a timed test-session trial are available.

The repository already contains a timetable import script and a substitution engine. Confirm active TEST timetable, teacher initials, and roster coverage against the actual test target before wiring photo apply; do not reimport from the legacy timetable repository on assumption. The existing staff outbox has transactional claim and cancellation controls; a verified two-minute delay tied to the undo command is still required. Substitution photo apply, voice intents, and the offline/admin phase are future commits.

## Pilot and configuration

This change starts disabled. Set `VPPSONE_BUILTIN_AI_TEST=1` only for a confined deployment, with an approved paid Gemini API project and synthetic material. The hosted Supabase project formerly called schoolfees-dev is One production (D-346); `TEST-2026-27` is its fenced test session. Configure this only after the test identity/session, school consent, data handling and provider project are checked. The pilot refuses production deployments. Keep the key out of browser variables, source, logs and screenshots.

- `GEMINI_API_KEY`: server only.
- `GEMINI_MODEL`: defaults to `gemini-3.5-flash-lite`; `GEMINI_MODEL_VISION` defaults to the same. `gemini-2.5-flash` can be evaluated if the account can use it; Google says it will automatically route to Flash-Lite from December 1, 2026. Track the provider's reported model version as well as the requested name.
- `GEMINI_MODEL_FALLBACK`: defaults to `gemini-3.8-flash`. Retry once on a transient error or unusable output; no provider tools, and no automatic retries inside the SDK.
- `GEMINI_THINKING_LEVEL`: `minimal` (default) or `low`; models requiring low use low. `GEMINI_THINKING_BUDGET`: 0–2048 for 2.5 Flash before the routing change.
- `GEMINI_INR_PER_USD`: required accounting conversion rate for token cost estimates. In AI Studio → Spend, configure a $20 monthly project cap before running. Google notes its cap is not instantaneous. Provider failures sometimes omit usage. Reconcile estimates and credit balance with the provider bill; ₹300–700/month is the plan's estimate, pending a real usage baseline.
- Media is uploaded directly to private Storage and used inline; there is no second upload to the Gemini Files API. The nightly cleanup deletes media and removes raw/reviewed/applied row details after 90 days; the ledger retains status, actor, target and usage metadata. The app's nightly Drive export excludes these transient inputs and ledger. Infrastructure backup retention is governed separately.

References: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [spend caps](https://ai.google.dev/gemini-api/docs/billing#project-spend-caps), [data and age terms](https://ai.google.dev/gemini-api/terms), [audio formats](https://ai.google.dev/gemini-api/docs/audio), [signed Storage uploads](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl).

## Private evaluation

For development, create an offline synthetic pack with `npm run ai:fixtures -- "<new folder outside the checkout>"`. It generates 20 cases per action, varied handwriting-style rendering, and matching answer keys. Cover cases include the school's register layout: an absent teacher grouped across periods, Roman numerals, class cells with subject labels, and rotated photos with another day partly visible. Only the layout is reproduced; the school photograph and identifiers are excluded. Use `--validate-only` offline or `--run-synthetic` for an approved model comparison. A `synthetic` manifest cannot be used with `--run` or count toward the 95% handwriting gate.

Use a restricted folder on D: outside the repository. Collect at least 20 genuine handwriting examples of each form, with school-reviewed de-identification before provider use. Have a reviewer type the true row values in the same page/row order. Keep filenames and IDs anonymous. Store JPEGs at up to 1600 px on the long side and 2 MiB each, up to four pages per case. Do not put private sheets or transcripts in Git.

Write a `manifest.json` with this shape. The example is marked synthetic; only a reviewed real handwriting set should declare `school-approved-deidentified`.

```json
{
  "provenance": "synthetic",
  "cases": [
    {
      "id": "marks-01",
      "action": "marks-photo",
      "files": ["marks-01.jpg"],
      "context": {"classLabel": "7B", "maxMarks": 40, "roster": [{"ref": "R1", "roll": "1", "name": "Sample Student"}]},
      "expected": {"rows": [{"roll": "1", "name": "Sample Student", "marks": "21.5", "rosterRef": "R1", "unclear": false}]}
    },
    {
      "id": "cover-01",
      "action": "substitution-photo",
      "files": ["cover-01.jpg"],
      "context": {"date": "2026-11-04", "periods": [1, 2, 3], "teachers": [{"initials": "SK"}, {"initials": "RP"}]},
      "expected": {"rows": [{"absentTeacher": "SK", "period": "2", "classLabel": "7B", "substitute": "RP", "unclear": false}]}
    }
  ]
}
```

`npm run ai:eval -- --validate-only "<private folder>"` checks the manifest locally without a key or provider requests. After review, set `GEMINI_EVAL_APPROVED=1` and use `npm run ai:eval -- --run "<private folder>" gemini-3.5-flash-lite gemini-3.8-flash`. The runner scores each model separately, with no fallback. Missing or extra rows reduce the score. It prints only aggregate field accuracy, errors and latency. The marks acceptance bar is ≥95% on written roll, name and mark cells, plus a timed 40-student photo-to-save trial under a minute on the target phone. Substitutions need a 5–10-row trial under a minute and zero wrong WhatsApp notices in testing. Repeat the baseline before switching prompts or models. Keep every phase as a separate commit and record local vs hosted evidence before cutover.
