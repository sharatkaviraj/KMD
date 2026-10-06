/**
 * Records every outgoing HTTP request the server makes, for
 * `scripts/measure-round-trips.mjs`. Loaded into `next start` with
 *
 *   NODE_OPTIONS="--import ./scripts/trace-fetch.mjs" TRACE_FETCH_FILE=… npm run start
 *
 * It writes one JSON line per finished request: origin, method, path (query
 * dropped — a PostgREST query string can carry ids), start and end in epoch
 * milliseconds. Nothing else: no headers, no bodies, no tokens.
 *
 * Node's built-in `fetch` is undici, and undici publishes these channels, so
 * this sees Supabase calls whichever client made them.
 */
import { appendFileSync } from "node:fs";
import diagnostics from "node:diagnostics_channel";

const file = process.env.TRACE_FETCH_FILE;
const starts = new WeakMap();
const now = () => performance.timeOrigin + performance.now();

if (file) {
  diagnostics.subscribe("undici:request:create", ({ request }) => {
    starts.set(request, now());
  });

  const finish = (failed) => ({ request }) => {
    const start = starts.get(request);
    if (start === undefined) return;
    starts.delete(request);
    appendFileSync(
      file,
      JSON.stringify({
        origin: request.origin,
        method: request.method,
        path: String(request.path).split("?")[0],
        start,
        end: now(),
        failed,
      }) + "\n",
    );
  };

  diagnostics.subscribe("undici:request:trailers", finish(false));
  diagnostics.subscribe("undici:request:error", finish(true));
}
