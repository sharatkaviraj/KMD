# School Office component browser QA

Runs actual certificate and government-return components with their VX styles,
pinned local font files and `LanguageProvider`. Vite replaces only server actions
and Next navigation/link plumbing. All pupils, IDs, documents and commands are
synthetic. Browser traffic outside the loopback fixture origin is aborted.
The stored PDF preview and downloadable file bodies are synthetic stubs; this
suite does not verify real PDF generation, database writes or portal acceptance.

PowerShell, from the repository root (existing dependencies and Chromium required):

```powershell
$qaScratch = 'D:\Codex\scratch\school-office-release-2026-11-01\browser'
New-Item -ItemType Directory -Force -Path $qaScratch | Out-Null
$env:TEMP = $qaScratch
$env:TMP = $qaScratch
node node_modules/@playwright/test/cli.js test --config tests/playwright/school-office.playwright.config.ts
```

The configuration writes results, failure traces and screenshots to that D: folder.
It starts its own isolated loopback Vite server on port 3216 and uses no database,
environment credentials, user login or shared live browser.

Coverage: 30 viewport/language/theme combinations (360, 390, 430, 1280, 1440px;
English, Hindi, both; light/dark), each visiting ten actual component screens;
sixteen workflow tests cover keyboard issue/Back, retained retry command IDs,
authoritative correction links, register filtering/pagination, manual exclusions,
verified-format blocking, file versus portal outcome, import conflicts and outages.
The added board/results cases cover retained departed candidates, exact raw
official values, pending without invented zeroes, unknown appearance, explicit
subject selection and unconfigured sources/deadlines. Partial acceptance checks
the exact SR list. Certificate cases cover pinned artifact retry, explicit new
issue disclosure and durable download-request denial/retry before navigation.
The measurements check document/container overflow and text within action and pill bounds.
