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
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
