import { defineConfig, devices } from "@playwright/test";

/**
 * The workflow suite: real clicks, real saves, real reloads.
 *
 * Everything else in this repository checks a value or a response. This checks
 * what happens when somebody presses the button — which is the only thing that
 * found the last four bugs (D-86 through D-89, and B-21 in R0.2). The installed
 * Next.js guide recommends exactly this for `async` Server Components, which is
 * most of this app: `node_modules/next/dist/docs/01-app/02-guides/testing/index.md`
 * says to prefer end-to-end testing over unit testing for them.
 *
 *   npm run smoke:workflows            # against a production build on :3100
 *   npm run smoke:workflows -- --ui
 *   APP_ORIGIN=https://… npm run smoke:workflows
 *
 * **Not part of `npm run check`.** It needs a database and a browser, and CI
 * has neither; `check` stays the thing that must pass before a merge and this
 * is the thing that must pass before a phase gate (PLAN §5).
 *
 * A production build rather than `next dev`, because the states being tested —
 * a save racing a reload, a stale tab, a streamed guard — behave differently
 * under the dev server's compilation and its error overlay.
 */

const origin = process.env.APP_ORIGIN ?? "http://localhost:3100";
const reusingAnExistingServer = Boolean(process.env.APP_ORIGIN);

export default defineConfig({
  testDir: "./tests/e2e",
  // Loads the heavy route module graphs once, before the first test's clock
  // starts. After the fee port a cold signed-in render costs more than a
  // 60-second test budget, and three specs failed on it while the element
  // they were waiting for was on the page. See the file for why this rather
  // than a longer timeout.
  globalSetup: "./tests/e2e/warm-server.ts",
  // Serial by default. These journeys write to one shared dev database, and
  // two of them marking the same register at once would be testing the
  // fixture rather than the app.
  fullyParallel: false,
  workers: 1,
  // A `.only` left behind is a suite that silently stops covering things.
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: "playwright-report.json" }]] : "list",
  // Long enough for a cold Vercel function, short enough that a hang is a
  // failure rather than an afternoon.
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      // The phone, because that is what the staff hold. A desktop pass is
      // R7.2's responsive sweep, not this suite's job.
      name: "phone",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: reusingAnExistingServer
    ? undefined
    : {
        command: "npm run start -- -p 3100",
        url: "http://localhost:3100/login",
        /*
         * **false**, and this is the important line in the file.
         *
         * `true` lets Playwright attach to whatever is already on 3100 —
         * including a server started before the build you just made. Three
         * specs "failed" that way after the fee port, each waiting sixty
         * seconds for an element that was, on inspection, right there on the
         * page: the running server simply did not have it yet. The D3
         * evidence records the same trap costing a whole debugging session.
         *
         * A failure that looks identical to a real one is worse than a slow
         * suite. Starting a fresh server costs a few seconds; believing a
         * stale one costs an afternoon. `APP_ORIGIN` still skips the whole
         * webServer block, which is the supported way to point this at a
         * server you are running deliberately.
         */
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
