/**
 * Server errors to Sentry without the Sentry SDK (go-live Phase G, plan §9.1,
 * critique1 B9).
 *
 * The fee app wires `@sentry/nextjs`; this port left it out on purpose
 * (next.config.ts): the SDK is a build plugin, a source-map token and 150 KB
 * of browser bundle, and in a port this size a Sentry build failure looks
 * exactly like a port failure. What the go-live needs is smaller: **a thrown
 * error in a route handler, a server action or a server render reaches
 * Sentry**, so a broken webhook or job is seen the day it breaks. Next's
 * `onRequestError` hook (src/instrumentation.ts) hands us exactly those, and
 * Sentry accepts a plain HTTP envelope — so this file is the whole client.
 *
 * Off unless `SENTRY_DSN` is set — One's own Sentry project. Never
 * `NEXT_PUBLIC_SENTRY_DSN`: that name is set on both Vercel projects and
 * nothing records whether One's copy is the fee app's project, so reading it
 * would mix One's errors into the fees project from the day this merged
 * (review of PR #149). What it sends is deliberately
 * thin, because this app holds children's and families' data:
 *
 *  - the route **template** (`/fees/students/[id]`), never the path with an id
 *    in it, and never a query string (job tokens travel as `?token=`);
 *  - no headers, cookies, body, user or IP;
 *  - the error's type, its message with phone numbers and emails masked, and
 *    its stack frames (file, function, line).
 *
 * Not covered: errors in the browser (they need the SDK's client half). The
 * fee app's lazy-loaded client SDK is the pattern to port when that is wanted.
 *
 * Pure apart from `reportServerError`, which posts and never throws.
 */

export type SentryDsn = { publicKey: string; host: string; protocol: string; projectId: string; pathPrefix: string };

/** `https://<key>@<host>/<project>` → its parts, or null for anything else. */
export function parseDsn(dsn: string | undefined | null): SentryDsn | null {
  const raw = dsn?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!url.username || !projectId || !/^\d+$/.test(projectId)) return null;
  return {
    publicKey: decodeURIComponent(url.username),
    host: url.host,
    protocol: url.protocol.slice(0, -1),
    projectId,
    pathPrefix: segments.length ? `/${segments.join("/")}` : "",
  };
}

export function envelopeUrl(dsn: SentryDsn): string {
  return `${dsn.protocol}://${dsn.host}${dsn.pathPrefix}/api/${dsn.projectId}/envelope/`;
}

export function authHeader(dsn: SentryDsn): string {
  return `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=vppsone-lite/1.0`;
}

/** A phone number or an email in an error message is masked before it leaves. */
export function scrub(text: string): string {
  return text
    .replace(/[^\s@<>()"']+@[^\s@<>()"']+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?<!\d)(?:\+?91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g, "[phone]")
    .slice(0, 2000);
}

type Frame = { function?: string; filename: string; lineno?: number; colno?: number; in_app: boolean };

/** V8 stack lines → Sentry frames, oldest first (as Sentry wants them). */
export function framesFrom(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 60)) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    const [, fn, filename, lineno, colno] = match;
    frames.push({
      function: fn || undefined,
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !/node_modules|node:internal|^node:/.test(filename),
    });
  }
  return frames.reverse();
}

export type RequestFacts = {
  method?: string;
  /** Next's route template, e.g. `/fees/students/[id]`. */
  routePath?: string;
  routeType?: string;
  routerKind?: string;
};

/** Strip a query string and anything after `#`; keep the template only. */
function routeOnly(route: string | undefined): string | undefined {
  if (!route) return undefined;
  return route.split(/[?#]/)[0] || undefined;
}

/** The event Sentry is sent. `eventId` and `now` are passed in so this stays pure. */
export function buildEvent(
  error: unknown,
  facts: RequestFacts,
  options: { eventId: string; now: Date; environment?: string; release?: string },
) {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error thrown");
  const digest = (err as { digest?: unknown }).digest;
  const route = routeOnly(facts.routePath);
  return {
    event_id: options.eventId,
    timestamp: options.now.getTime() / 1000,
    platform: "node",
    level: "error",
    logger: "vppsone.onRequestError",
    environment: options.environment ?? "development",
    ...(options.release ? { release: options.release } : {}),
    transaction: route,
    tags: {
      ...(facts.method ? { method: facts.method } : {}),
      ...(facts.routeType ? { route_type: facts.routeType } : {}),
      ...(facts.routerKind ? { router_kind: facts.routerKind } : {}),
      ...(typeof digest === "string" ? { digest } : {}),
    },
    exception: {
      values: [
        {
          type: err.name || "Error",
          value: scrub(err.message || ""),
          stacktrace: { frames: framesFrom(err.stack) },
        },
      ],
    },
  };
}

/** The envelope body: header line, item header line, the event. */
export function envelopeBody(event: { event_id: string }, now: Date): string {
  const header = { event_id: event.event_id, sent_at: now.toISOString() };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
}

function newEventId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The DSN this deployment reports to, or null (then nothing is sent). */
export function configuredDsn(env: Record<string, string | undefined> = process.env): SentryDsn | null {
  return parseDsn(env.SENTRY_DSN);
}

/**
 * Post one server error. Never throws and never waits more than three
 * seconds: monitoring must not become the outage.
 */
export async function reportServerError(error: unknown, facts: RequestFacts): Promise<void> {
  const dsn = configuredDsn();
  if (!dsn) return;
  try {
    const now = new Date();
    const event = buildEvent(error, facts, {
      eventId: newEventId(),
      now,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    });
    await fetch(envelopeUrl(dsn), {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": authHeader(dsn) },
      body: envelopeBody(event, now),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Sentry unreachable: the error is still in the platform's own logs.
  }
}
