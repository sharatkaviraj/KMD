# Bounded academic follow-up

`timetable-leave-followup.test.ts` executes the actual leave Server Action with
an independent in-memory conditional-update state. It proves winner/loser
handling and capped/manual result counts, not database concurrency or notices.

`cover-followup.spec.ts` renders the existing real timetable component and
styles with NEW transport/action stubs. It uses browser offline emulation plus
stubs that refuse requests while `navigator.onLine` is false. An independent
synthetic command-row store and attempt journal verify original-ID retry and
receipt-only recovery after a committed lost response. These are component
tests, not actual Next server/offline database persistence or physical devices.
All test content is synthetic; no auth, DB, staff notices or family sends.

```sh
node node_modules/vitest/vitest.mjs run tests/timetable-leave-followup.test.ts --maxWorkers 1
node node_modules/@playwright/test/cli.js test --config tests/playwright/academic-followup.playwright.config.ts
```

For static fulfillment build with `tests/academic-followup/vite.config.ts` to
an isolated directory, set `PHONEOPS_ACADEMIC_FOLLOWUP_DIR` to its absolute
path and run the same Playwright command. Only127.0.0.1 files beneath that
directory are served; external requests abort. Two focused cases run at each
touch360/390/412 portrait and844x390 landscape. This config does not run the
earlier60-case academic suite.

Persisted cover/absence/leave tests remain blocked by recipient isolation.
New job/retry/dispatch design, a larger14-day arrangement cap, or notification
scope changes require separate review and approval. This follow-up preserves
existing grants, permission checks, preview guards and notification behavior.
