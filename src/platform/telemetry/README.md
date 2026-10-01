# Performance telemetry

The existing office emitter is now consumed by `PerformanceReporter`, mounted
once in the protected workspace. It records Web Vitals and existing workflow
measurements on a 10% sample of workspace visits, in batches up to 20. Hidden
pages flush before suspension. No third-party analytics project is required.

The authenticated `/api/performance` endpoint validates fixed event names and
route categories, bounded values and a 16 KiB request limit. It drops unknown
fields and logs only `{kind, role, events}` to hosting logs. Dynamic path segments,
URLs, student ids, tokens, names, phones, amounts and emitter metadata are omitted.
Events include a coarse viewport bucket (phone/tablet/desktop) and installed
state for comparisons, without recording the user agent or exact screen size.
The per-instance rate limiter limits log volume, not authorization.

`CLS` values are unitless; LCP/INP/FCP/TTFB and workflow values are milliseconds.
Targets are p75 LCP <= 2500 ms, INP <= 200 ms, CLS <= 0.1; local tap feedback
<= 100 ms, warm data p95 <= 800 ms and ordinary saves p95 <= 1500 ms.
A lab run or bundle reduction does not establish these field targets. Aggregate
sampled hosting logs over representative real staff usage before claiming them.

`npm run check:bundles` compares unique route-referenced gzip chunks against the
pre-change production baseline. This guards regressions; it does not estimate
browser transfer size, LCP or INP. `form_saved` measures the confirmed server
response; financial posting retains its existing `payment_post_confirmed` event.
