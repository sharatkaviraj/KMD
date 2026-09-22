import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

/**
 * A `fetch` that refuses an over-long PostgREST URL immediately, and says so.
 *
 * **What this is defending against.** A `.in(...)` filter is serialized into
 * the request URL, so a list of uuids costs about 37 bytes each. Past roughly
 * 300 ids the URL is longer than the server will accept — and the way that
 * fails is the problem. `fetch` does not refuse it: it hangs for about **eight
 * seconds** and then rejects with a bare `TypeError: fetch failed`, which
 * supabase-js turns into `{ data: null, error }`. The very common call shape
 *
 *     const { data } = await supabase.from("x").select().in("id", ids)
 *
 * discards that error, so the caller gets an empty array and renders a
 * plausible, wrong screen. The defaulters queue lost four columns of data that
 * way and took sixteen seconds to do it, and nothing anywhere said a query had
 * failed.
 *
 * Chunking each call site with `fetchInChunks` is the real fix and there are
 * over a hundred and fifty of them. This is the net underneath: it costs one
 * comparison per request, turns eight seconds into none, and replaces
 * `TypeError: fetch failed` with a message naming the table and the length —
 * so the next one is found by reading a log line instead of by bisecting a
 * screen that renders nothing.
 *
 * It cannot make a discarded error loud; nothing at this layer can. It can
 * make the same failure instant, named, and greppable, which is the difference
 * between a bug somebody finds and a bug somebody lives with.
 *
 * The limit is deliberately below where the server actually breaks. 300 ids
 * (~11 KB) was measured working and 400 (~15 KB) failing; 12,000 characters
 * sits between them, so a request this refuses would have failed anyway.
 */
const MAX_URL_LENGTH = 12_000;

/** `…/rest/v1/students?…` → `students`, for the message. */
function tableFrom(url: string): string {
  return url.match(/\/rest\/v1\/([^?/]+)/)?.[1] ?? "a table";
}

/** Roughly how many ids are in the filter, so the message suggests a fix. */
function idCountFrom(url: string): number {
  return (url.match(/%2C/gi)?.length ?? url.match(/,/g)?.length ?? 0) + 1;
}

/**
 * `underlying` is for tests only, and defaulting it is deliberately avoided.
 *
 * Next.js replaces the global `fetch` with an instrumented one to do its own
 * caching, and that instrumentation reads request-scoped state. Capturing a
 * reference to `fetch` when the client is *constructed* and calling it later
 * hands `unstable_cache` a function from the wrong scope — which surfaces as
 * "Route used `cookies()` inside a function cached with `unstable_cache()`"
 * and leaves the Payment Desk on its skeletons forever. Reading
 * `globalThis.fetch` at call time always uses whichever fetch Next has
 * installed for the scope the call is actually in.
 */
export function createGuardedFetch(underlying?: typeof fetch): typeof fetch {
  return async function guardedFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.length > MAX_URL_LENGTH) {
      const table = tableFrom(url);
      const ids = idCountFrom(url);

      throw new Error(
        `Refusing a ${url.length}-character request to ${table}: a PostgREST ` +
          `filter this long (about ${ids} values) does not fit in the request ` +
          `URL and would fail after an eight-second stall. Batch it with ` +
          `fetchInChunks(ids, IN_FILTER_CHUNK_SIZE, …) from ` +
          `@/platform/helpers/chunk — ${IN_FILTER_CHUNK_SIZE} at a time. ` +
          `See src/platform/helpers/in-filter.ts.`,
      );
    }

    return (underlying ?? globalThis.fetch)(input, init);
  };
}
