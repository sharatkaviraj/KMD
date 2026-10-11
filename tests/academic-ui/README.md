# Academic phone component checks

These tests render the actual timetable component and styles with synthetic data,
browser-history adapters and action stubs. They prove component behavior and the
submitted synthetic command payload. They do not prove database persistence,
authenticated role policy or physical-device behavior.

Run with installed repository dependencies:

```sh
node node_modules/@playwright/test/cli.js test --config academic-ui.playwright.config.ts
```

For a compiled fixture without a server, first build to a dedicated directory:

```sh
node node_modules/vite/bin/vite.js build --config tests/academic-ui/vite.config.ts --outDir ../../../academic-phone-artifact
```

Set `PHONEOPS_ACADEMIC_STATIC_DIR` to the absolute build directory, then run the
same Playwright command. Static fulfillment permits only local fixture files
under that directory and blocks external requests. Do not point it at a live
application. Browser tests use `isMobile` and `hasTouch` at 360, 390, 412 pixels,
and 844 by 390 landscape.

The fifteen cases cover publication boundaries, selected substitution date
through dialog/tab/history/reload, current-day period markers, uncertain saved
and unsaved cover responses, original-ID recovery, owner/session/day isolation,
storage failures before save and after receipt, two-tab reservation, unsupported
Web Locks, read-only role preview, Hindi controls, delayed context switches and
receipt recovery after the timetable is no longer arrangable and a late saved
response after switching to read-only preview. Native touch taps
and a scoped held Web Lock exercise two tabs in the same browser context. The
per-tab action output independently verifies only one submitted command; a
shared synthetic ledger is additional evidence, never a real database ledger.

Focused units are `tests/timetable-preview-access.test.ts`,
`tests/cover-recovery.test.ts` and `tests/timetable-cover-actions.test.ts`.
Cover saves require secure-context Web Locks and working browser storage. If
either is unavailable, the UI refuses submission with a persistent explanation.
