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

The three cases cover reader versus editor previews, selected substitution date
through dialog/tab/history/reload navigation, and future-day/current-day period
markers. Loader access is separately checked by
`tests/timetable-preview-access.test.ts`.
