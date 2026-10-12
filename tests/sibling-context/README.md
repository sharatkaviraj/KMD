# Sibling directory context phone regression

This synthetic fixture renders the actual StudentsScreen, Student360, NavTrail and localized Back link. Next routing and server actions are replaced with deterministic stubs. No authentication, database access, real family data or messages are involved. Only GET requests to `http://127.0.0.1:3221` are permitted; static mode fulfills local build artifacts and starts no server.

The test opens a directory with search, class, Fees view, Pending segment and page 2; taps the primary student, Family and sibling; checks Browser Back/Forward as history controls; then taps the sibling's localized Back arrow. The final URL must equal the original directory, with all parameters preserved, and the primary student must be visible. JSON attachments expose the real link hrefs, URL, coarse pointer, viewport, Back target and zero synthetic action attempts. Screenshots contain only explicitly synthetic names and IDs.

## Local execution

From the repository root, after acquiring the shared browser/build slot:

```powershell
node node_modules/vite/bin/vite.js build --config tests/sibling-context/vite.config.ts
$env:PHONEOPS_SIBLING_STATIC_DIR='../evidence/sibling-context-static'
node node_modules/@playwright/test/cli.js test --config student360-sibling.playwright.config.ts
```

Use the existing Playwright browser cache when required by the host. The managed Windows host requires approved local networking for browser execution. CI uses its prebuilt static fixture. No credentials are required.

## Verified RED/GREEN checkpoint

On 2026-10-12 at 00:23:43.938 UTC, the 390x844 touch baseline failed the final URL assertion: the sibling link and app Back href had lost returnTo, and the app returned to `/students`. Browser Back and Forward controls passed; Back was 44x44px, coarse pointer was true, and action attempts and blocked requests were both zero. The complete run was 6.668 seconds. Baseline JSON and screenshots were preserved privately before the fix.

After the single product change to `studentProfileHref(m.id, p.returnTo)`, a fresh build and all three portrait touch cases (360x800, 390x844, 412x915) passed on 2026-10-12 at 00:25:03.770 UTC. The full run took 9.321 seconds, with 3 expected, 0 failed, 0 skipped and no retries. The root coordinator independently reviewed the one href change and read the result JSON. Aggregate repository/release checks remain the coordinator's responsibility.

This is Chromium mobile touch emulation, not a physical handset result. It tests synthetic client navigation and the actual rendered components, not Next server authorization or database sibling visibility. It does not include the global bottom navigation or claim landscape, keyboard, offline or physical OS Back coverage.
