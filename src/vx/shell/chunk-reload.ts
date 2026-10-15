/**
 * A screen whose JavaScript chunk did not arrive (coordinators B10,
 * class-teacher BUG-12). On weak 4G a chunk request times out, and the error
 * boundary used to replace the whole page with Next's English "This page
 * couldn't load". The chunk is almost always there on a second try, and the
 * service worker serves the ones that did arrive from its cache — so the
 * first answer is to reload, once, by itself.
 */

/** Webpack's ChunkLoadError, a CSS chunk, or a dynamic `import()` that failed. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (name === "ChunkLoadError") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return (
    /Loading (CSS )?chunk [\w./-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message)
  );
}

const KEY = "vx.chunk-reload";
/** A second failure within this long is not a flaky chunk; show the page instead of looping. */
const AGAIN_AFTER_MS = 60_000;

type ReloadTarget = {
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  location: Pick<Location, "reload">;
};

/**
 * Reload the page unless this tab already did so for a chunk in the last
 * minute. True when a reload was started. Without storage it never reloads:
 * a loop on a phone with no network is worse than the error page.
 */
export function reloadOnceForChunk(target: ReloadTarget, now: number = Date.now()): boolean {
  let last = 0;
  try {
    last = Number(target.sessionStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return false;
  }
  if (now - last < AGAIN_AFTER_MS) return false;
  try {
    target.sessionStorage.setItem(KEY, String(now));
  } catch {
    return false;
  }
  target.location.reload();
  return true;
}
