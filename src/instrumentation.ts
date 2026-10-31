import type { Instrumentation } from "next";

/**
 * Next's instrumentation hook (go-live Phase G, plan §9.1).
 *
 * Every error thrown in a route handler, a server action, a server render or
 * the proxy is posted to Sentry when a DSN is set, and nothing happens when
 * it is not — see `src/platform/observability/sentry-lite.ts` for what is
 * sent (the route template and the error, never the path, query, headers or
 * user). Imported lazily so a deployment without a DSN loads nothing extra.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  const { reportServerError } = await import("@/platform/observability/sentry-lite");
  await reportServerError(error, {
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
};
