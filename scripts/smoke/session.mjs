/**
 * A persistent browser seat for an agent that works step by step.
 *
 *   import { withSeat } from "<repo>/scripts/smoke/session.mjs";
 *   await withSeat("teacher3", async ({ page, go, shot, outline, clock, file }) => {
 *     await go("/teach");
 *     console.log(await outline());
 *     await shot("today");
 *   });
 *
 * The first call signs the seat in with its pass from the run's kit
 * (`<SMOKE_RUN_DIR>/kit.json`, default `.smoke-run/kit.json`); every later call
 * reuses the saved cookies (`state/<seat>.json`), so an agent can run many
 * short scripts as one continuous session. Requests to any host but the app and
 * the test database are aborted, as in `lib.mjs`. Each call prints the page
 * errors, server errors and blocked requests it saw, and screenshots are small
 * JPEGs under `shots/<seat>/`.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";

import { fileFinding } from "./lib.mjs";

export const RUN_DIR = path.resolve(process.env.SMOKE_RUN_DIR ?? ".smoke-run");

const ALLOWED_HOSTS = ["wtgxcptmucjerhufzjcf.supabase.co", ".vercel-insights.com", ".vercel-scripts.com"];

export function readKit() {
  return JSON.parse(readFileSync(path.join(RUN_DIR, "kit.json"), "utf8"));
}

/** The kit entry for a seat key such as "teacher3" or "admin". */
export function seatOf(key) {
  const kit = readKit();
  const agent = kit.agents.find((a) => a.email === `smoke.${key}@qa.vpps.local`);
  if (!agent) throw new Error(`No seat "${key}" in this run's kit.`);
  return { origin: kit.origin, ...agent };
}

export async function withSeat(key, fn, { width = 390, height = 844, offline = false } = {}) {
  const seat = seatOf(key);
  const origin = seat.origin;
  const appHost = new URL(origin).hostname;
  const stateDir = path.join(RUN_DIR, "state");
  const shotDir = path.join(RUN_DIR, "shots", key);
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(shotDir, { recursive: true });
  const stateFile = path.join(stateDir, `${key}.json`);

  const browser = await chromium.launch({ headless: true });
  const mobile = width < 768;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, storageState: existsSync(stateFile) ? stateFile : undefined });
  const page = await context.newPage();
  const seen = { blocked: [], pageErrors: [], serverErrors: [], consoleErrors: [] };
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === appHost || host === "localhost" || host === "127.0.0.1" || ALLOWED_HOSTS.some((s) => host === s || host.endsWith(s))) return route.continue();
    seen.blocked.push(route.request().url());
    return route.abort();
  });
  page.on("pageerror", (e) => seen.pageErrors.push(`${page.url()} ${String(e).slice(0, 300)}`));
  page.on("console", (m) => { if (m.type() === "error") seen.consoleErrors.push(`${page.url()} ${m.text().slice(0, 300)}`); });
  page.on("response", (r) => { if (r.status() >= 500 && new URL(r.url()).hostname === appHost) seen.serverErrors.push(`${r.status()} ${r.url()}`); });

  const signIn = async (next = null) => {
    const url = new URL("/lab/enter", origin);
    url.searchParams.set("pass", seat.pass);
    if (next) url.searchParams.set("next", next);
    await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 90_000 });
    if (new URL(page.url()).pathname.startsWith("/lab/ended")) throw new Error(`Seat ${key}: the pass did not sign in (${page.url()}).`);
  };

  const helpers = {
    page,
    seat,
    /** Open a path; returns how long it took in ms. Re-signs in once if the session was lost. */
    async go(p, { wait = "networkidle" } = {}) {
      const started = performance.now();
      await page.goto(new URL(p, origin).toString(), { waitUntil: wait, timeout: 90_000 });
      if (new URL(page.url()).pathname === "/login") {
        await signIn(p);
      }
      return Math.round(performance.now() - started);
    },
    /** A small JPEG of the viewport (or the full page). Returns its path for the Read tool. */
    async shot(name, { full = false } = {}) {
      const file = path.join(shotDir, `${name.replace(/[^a-z0-9_-]+/gi, "-")}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 45, fullPage: full });
      return file;
    },
    /** The page's accessibility outline (what a screen reader would hear), trimmed. */
    async outline(max = 7000) {
      const text = await page.locator("body").ariaSnapshot().catch(() => "");
      return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
    },
    /** Move this seat's pretend school clock, then land on `next`. */
    async clock(at, next = "/") {
      const url = new URL("/lab/clock", origin);
      url.searchParams.set("pass", seat.pass);
      url.searchParams.set("at", at);
      url.searchParams.set("next", next);
      await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 90_000 });
    },
    /** File a finding as this seat: { kind, severity, title, screen, steps, expected, actual, evidence }. */
    async file(finding) {
      return fileFinding(origin, seat.pass, finding);
    },
    /** Elements narrower than 44 px a finger has to hit, on this screen. */
    async smallTargets() {
      return page.evaluate(() =>
        [...document.querySelectorAll("a, button, input, select, [role=button], [role=tab]")]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); })
          .slice(0, 30)
          .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
      );
    },
    /** True when the page is wider than the screen (sideways scrolling). */
    async overflows() {
      return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    },
  };

  try {
    if (!existsSync(stateFile)) await signIn();
    if (offline) await context.setOffline(true);
    return await fn(helpers);
  } finally {
    await context.storageState({ path: stateFile }).catch(() => undefined);
    const report = Object.entries(seen).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.slice(0, 8).join(" | ")}`);
    if (report.length) console.log(`[seat ${key}] ${report.join("\n")}`);
    await browser.close();
  }
}
