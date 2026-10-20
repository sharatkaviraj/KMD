/**
 * The Smoke Lab agent harness: sign in with a pass, keep every request inside
 * the app, and record what goes wrong. Used by `sweep.mjs`, and importable by
 * any agent that drives Playwright itself.
 *
 *   import { openAgent, fileFinding, brief } from "./scripts/smoke/lib.mjs";
 *   const agent = await openAgent(kit.origin, kitAgent.pass, { width: 390 });
 *   ... agent.page is signed in as that seat ...
 *   await agent.close();
 *
 * Every request to a host that is not the app or its Supabase project is
 * aborted and recorded (so a wa.me link or a payment gateway can never be
 * reached), and `agent.blocked` must be empty at the end of a clean run.
 */

import { chromium } from "@playwright/test";

// The test database only (never the live fee project), and Vercel's own scripts.
const ALLOWED_HOST_SUFFIXES = ["wtgxcptmucjerhufzjcf.supabase.co", ".vercel-insights.com", ".vercel-scripts.com"];

export async function brief(origin, pass) {
  const res = await fetch(`${origin}/api/lab/brief`, { headers: { authorization: `Bearer ${pass}` } });
  if (!res.ok) throw new Error(`Brief refused (${res.status}): the pass is expired, revoked or wrong.`);
  return res.json();
}

/** File one finding. Returns { id, repeat }. Never throws: a lost finding is logged, not fatal. */
export async function fileFinding(origin, pass, finding) {
  try {
    const res = await fetch(`${origin}/api/lab/findings`, { method: "POST", headers: { authorization: `Bearer ${pass}`, "content-type": "application/json" }, body: JSON.stringify(finding) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`finding not filed (${res.status}): ${finding.title} ${JSON.stringify(body)}`);
    return body;
  } catch (error) {
    console.error(`finding not filed: ${finding.title}: ${error}`);
    return null;
  }
}

export async function openAgent(origin, pass, { width = 390, height = 844, headless = true, next = null, browser: shared = null } = {}) {
  const browser = shared ?? (await chromium.launch({ headless }));
  const appHost = new URL(origin).hostname;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 768, isMobile: width < 768 });
  const page = await context.newPage();
  const record = { blocked: [], consoleErrors: [], pageErrors: [], serverErrors: [] };
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === appHost || host === "localhost" || host === "127.0.0.1" || ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return route.continue();
    record.blocked.push(route.request().url());
    return route.abort();
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") record.consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 500) });
  });
  page.on("pageerror", (error) => record.pageErrors.push({ url: page.url(), text: String(error).slice(0, 500) }));
  page.on("response", (res) => {
    if (res.status() >= 500 && new URL(res.url()).hostname === appHost) record.serverErrors.push({ url: res.url(), status: res.status() });
  });
  const enter = new URL("/lab/enter", origin);
  enter.searchParams.set("pass", pass);
  if (next) enter.searchParams.set("next", next);
  await page.goto(enter.toString(), { waitUntil: "networkidle", timeout: 90_000 });
  if (new URL(page.url()).pathname.startsWith("/lab/ended")) throw new Error("The pass did not sign in (expired, revoked or wrong).");
  return {
    page,
    context,
    blocked: record.blocked,
    consoleErrors: record.consoleErrors,
    pageErrors: record.pageErrors,
    serverErrors: record.serverErrors,
    async setClock(at, nextPath = "/") {
      const url = new URL("/lab/clock", origin);
      url.searchParams.set("pass", pass);
      url.searchParams.set("at", at);
      url.searchParams.set("next", nextPath);
      await page.goto(url.toString(), { waitUntil: "networkidle" });
    },
    async close() {
      await context.close();
      if (!shared) await browser.close();
    },
  };
}
