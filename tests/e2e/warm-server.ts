import type { FullConfig } from "@playwright/test";

import { refuseOnProductionDatabase } from "./support/harness";

/**
 * Warm the server before the first test's clock starts.
 *
 * A production build does not compile on demand, but it does load a route's
 * module graph on first request — and after the School Fees port that graph is
 * most of an application. The first signed-in render pays for the shell, the
 * navigation map, both message catalogues and the fee module; measured cold at
 * well over 30 seconds on this laptop.
 *
 * That cost used to be absorbed by whichever test ran first. It is not any
 * more: three of the first four specs timed out at 60s waiting for a locator
 * that was, on inspection, right there on the page. The suite was measuring
 * warmth rather than behaviour, which is the failure mode PROGRESS already
 * records twice (B-40, and the D3 evidence note about `reuseExistingServer`).
 *
 * **Raising the timeout was the other option and is worse.** It would hide the
 * same cost in every test rather than paying it once, and a 120-second budget
 * turns a genuine hang into an afternoon. This pays it here, outside anybody's
 * clock, and leaves 60s meaning what it says.
 *
 * No sign-in. These requests get redirected to `/login` by `requireStaff()` in
 * the layout — but the redirect happens *inside* the layout, so the module
 * graph is loaded first, which is the expensive part. Warming without
 * credentials also keeps this setup out of the business of managing sessions.
 */
const WARM: readonly string[] = [
  // The shell itself, and the heaviest thing behind it.
  "/dashboard",
  "/fees/dashboard",
  // The two this app's own specs open first.
  "/teach",
  "/collection/rounds/upload",
  // Public, and the one route that is not behind the shell.
  "/login",
];

export default async function warmServer(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use?.baseURL ??
    process.env.APP_ORIGIN ??
    "http://localhost:3100";

  // D-346: these journeys write real-session rows; never on a production database.
  await refuseOnProductionDatabase();

  const started = Date.now();
  const timings: string[] = [];

  // A port being open does not prove it belongs to this app. Refuse a wrong
  // origin before any journey starts setting up or changing database rows.
  const identity = await fetch(new URL("/manifest.webmanifest", baseURL), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!identity.ok) throw new Error(`Workflow origin ${baseURL} has no VPPS One manifest.`);
  const manifest = await identity.json();
  if (manifest.short_name !== "VPPS One" || manifest.id !== "/") {
    throw new Error(`Refusing workflow tests: ${baseURL} is not VPPS One.`);
  }

  for (const path of WARM) {
    const at = Date.now();
    try {
      // `redirect: "manual"` so a guard's 307 is the answer rather than a
      // second request to /login for every one of these.
      const response = await fetch(new URL(path, baseURL), {
        redirect: "manual",
      });
      // Read it to the end. Dropping a streamed response on the floor makes
      // Next log "The destination stream closed early" — five of them, once
      // per warmed route, at the top of every run. Harmless, and exactly the
      // kind of noise somebody later spends an hour on.
      await response.arrayBuffer();
    } catch (error) {
      // A server that is not up is the webServer config's problem, and it
      // reports it far better than this would. Warming is best-effort.
      timings.push(`${path} unreachable (${(error as Error).message})`);
      continue;
    }
    timings.push(`${path} ${Date.now() - at}ms`);
  }

  // Printed rather than silent: when a spec fails on timing, the first
  // question is how cold the server was, and this is the answer.
  console.log(
    `warmed ${WARM.length} routes in ${Date.now() - started}ms — ${timings.join(", ")}`,
  );
}
