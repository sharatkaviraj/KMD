/**
 * Rethrow Next's own control-flow signals and let every other error through to
 * the caller's fallback.
 *
 * The same intent as `unstable_rethrow` from `next/navigation`, for the two
 * places that read the view-as cookie (D-544) and are reached by almost every
 * request: the staff resolver and the data clients' write lock. Importing
 * `unstable_rethrow` there made it part of every module that resolves staff,
 * and a test that mocks `next/navigation` without it then failed far from the
 * code it was testing.
 *
 * Next marks each signal it throws — a redirect, `notFound()`, a bailout to
 * dynamic rendering, a hanging prerender — with a string `digest`, and React's
 * postpone with `$$typeof`. An error that carries either is Next's, never
 * ours to swallow. The only other error these callers expect is "called
 * outside a request scope", which carries neither.
 */
export function rethrowNextSignal(error: unknown): void {
  if (typeof error !== "object" || error === null) return;
  const marked = error as { digest?: unknown; $$typeof?: unknown };
  if (typeof marked.digest === "string" && marked.digest.length > 0) throw error;
  if (marked.$$typeof === Symbol.for("react.postpone")) throw error;
}
