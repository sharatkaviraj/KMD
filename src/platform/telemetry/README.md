# `platform/telemetry` — the emitter, with no sink

`office-telemetry.ts` is ported and live: the Payment Desk, the student loader
and the service worker all call `recordOfficeMetric()`, which dispatches a
window event.

**Nothing listens to it here.** The fee app's four reporter components
(`src/ui/telemetry/*`) forwarded those events to Sentry, and Sentry is
deliberately not part of this port — it needs a second project, a DSN and a
source-map token, and in a 700-file move a Sentry build failure is
indistinguishable from a port failure.

So the reporters were deleted rather than kept with their import stripped.
Three files whose only job is to talk to Sentry, with the Sentry taken out,
are three files that look like they do something.

The emitter stays because it costs nothing, it is already threaded through the
screens that matter, and it is what a sink would attach to. When Sentry (or
anything else) is added, that is one component mounted in the root layout
listening for `office-metric` — not a re-instrumentation of the Payment Desk.
