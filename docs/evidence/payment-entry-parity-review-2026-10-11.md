# Independent payment parity review

Read-only independent review of PR77 found three recovery issues. The subsequent focused re-review found no additional important issues in their fixes. No reviewer database access, product edits, or heavy verification occurred.

- Two pre-opened tabs could overwrite the one owner/session recovery slot. Saving and clearing now acquire a browser Web Lock, re-read the durable record, compare request identity and all financial fields, and only update the same immutable operation. Duplicate acknowledgment can advance. Clearing must name the matching request. Conflicts restore the existing operation instead of sending another payment.
- Opening an unrelated duplicate receipt could discard a request whose permanent late-fee waiver had already committed. Waiver-bearing attempts now remain durable, refresh the student, show a persistent explanation, and return to the original check/retry path.
- A restored request that had never reached the server could save successfully after retry without updating the daily counter. Successful saves/checks now return an uncached authoritative daily total after financial refresh; failed total reads display unavailable. Backdated receipt reversals do not decrement today's collection.

The phone-test coordinator also reproduced a fee collector seeing the privileged mobile bulk-entry link. Its visibility now uses `canBulk`, with a browser permission regression.

Regression additions: four durable-attempt cases (concurrent writers, immutable same-request fields, stale clearing, unavailable Locks), two component recovery cases, and phone/browser cases for interrupted saves, permission visibility, and two pre-opened tabs. Fresh CI is required for these fixes.

Payment posting requires recovery storage and the Web Locks API in a secure browser context. If either cannot protect the operation, the desk refuses to send and explains the storage/recovery failure. This preserves the approved recovery guarantee rather than allowing an untracked financial request. Supported modern production browsers and Chromium CI exercise the real API.

Preserving a clerk's entered amount after changing date or waiver matches the School Fees source handlers. One's suggested amount is filled once on student selection; subsequent shortcuts update it explicitly. No schema, protected LIVE, real-money, or messaging operation was part of this work.
