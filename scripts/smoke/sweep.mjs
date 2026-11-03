#!/usr/bin/env node
/**
 * The Smoke Lab's scripted baseline: for every agent in a kit, sign in with its
 * pass, walk every screen its role can reach (links only — it never presses a
 * button, so it changes nothing), at phone and desktop width, and file what is
 * plainly broken as findings: server errors, crashes, console errors, pages
 * wider than the screen, pages slower than 6 s.
 *
 *   npm run smoke:sweep -- smoke-kit-1234abcd.json
 *   npm run smoke:sweep -- smoke-kit-1234abcd.json --roles teacher,office --max 30
 *
 * The kit is the JSON downloaded from /smoke when a run is opened. Runs one
 * agent at a time (this laptop manages about three browsers at once; the sweep
 * needs one). The AI agents do the judgement work; this catches the obvious.
 */

import { readFileSync } from "node:fs";
import process from "node:process";

import { chromium } from "@playwright/test";

import { fileFinding, openAgent } from "./lib.mjs";

const args = process.argv.slice(2);
const kitPath = args.find((a) => !a.startsWith("--"));
if (!kitPath) {
  console.error("Usage: npm run smoke:sweep -- <smoke-kit.json> [--roles teacher,office] [--max 40]");
  process.exit(1);
}
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};
const kit = JSON.parse(readFileSync(kitPath, "utf8"));
const roles = flag("roles")?.split(",") ?? null;
const maxPages = Number(flag("max") ?? 40);
const origin = kit.origin;

// Never followed: other doors, downloads, exports, prints and anything that does work on GET.
const SKIP = [/^\/lab\//, /^\/api\//, /^\/auth\//, /^\/login/, /^\/logout/, /^\/(r|t|w|pay|qa)\//, /export/i, /download/i, /print/i, /\.pdf$/i, /\.(csv|xlsx|json)$/i];

const pathOf = (href) => {
  try {
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin) return null;
    const path = `${url.pathname}${url.search}`;
    return SKIP.some((re) => re.test(url.pathname)) ? null : path;
  } catch {
    return null;
  }
};

async function sweepAgent(browser, agent) {
  console.log(`\n== ${agent.label} (${agent.role})`);
  let filed = 0;
  const file = async (finding) => {
    const res = await fileFinding(origin, agent.pass, { reporter: `sweep · ${agent.label}`, ...finding });
    if (res && !res.repeat) filed += 1;
  };
  for (const width of [390, 1280]) {
    const session = await openAgent(origin, agent.pass, { width, height: width < 768 ? 844 : 900, browser });
    const home = new URL(session.page.url()).pathname;
    const queue = [home];
    const seen = new Set();
    while (queue.length && seen.size < maxPages) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      const before = { console: session.consoleErrors.length, page: session.pageErrors.length, server: session.serverErrors.length };
      const started = Date.now();
      let status = 0;
      try {
        const res = await session.page.goto(new URL(path, origin).toString(), { waitUntil: "networkidle", timeout: 30_000 });
        status = res?.status() ?? 0;
      } catch (error) {
        await file({ kind: "bug", severity: "P2", title: "Screen did not finish loading within 30 s", screen: path, actual: String(error).slice(0, 300), evidence: `width ${width}` });
        continue;
      }
      const ms = Date.now() - started;
      if (new URL(session.page.url()).pathname.startsWith("/lab/ended")) {
        console.log("   pass ended; stopping this agent");
        break;
      }
      const facts = await session.page.evaluate(() => ({
        text: document.body.innerText.slice(0, 4000),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
      }));
      if (status >= 500) await file({ kind: "bug", severity: "P1", title: `Server error ${status} on a screen in the menu`, screen: path, evidence: `width ${width}` });
      else if (status === 404 && path !== home) await file({ kind: "bug", severity: "P2", title: "A link in the app leads to a missing page", screen: path, evidence: `width ${width}` });
      if (/Application error|Something went wrong|कुछ गलत हो गया/i.test(facts.text)) await file({ kind: "bug", severity: "P1", title: "Screen shows an error page", screen: path, evidence: facts.text.slice(0, 400) });
      if (facts.overflow > 2) await file({ kind: "bug", severity: "P3", title: `Page is wider than the screen at ${width} px`, screen: path, actual: `${facts.overflow} px of sideways scroll` });
      if (ms > 6000) await file({ kind: "improvement", severity: "P2", title: "Screen takes more than 6 s to load", screen: path, actual: `${(ms / 1000).toFixed(1)} s at ${width} px` });
      for (const e of session.pageErrors.slice(before.page)) await file({ kind: "bug", severity: "P2", title: "Script error on the page", screen: path, evidence: e.text });
      for (const e of session.consoleErrors.slice(before.console)) {
        if (/favicon|Download the React DevTools|net::ERR_ABORTED/i.test(e.text)) continue;
        await file({ kind: "bug", severity: "P3", title: "Console error", screen: path, evidence: e.text });
      }
      for (const href of facts.links) {
        const next = pathOf(href);
        if (next && !seen.has(next)) queue.push(next);
      }
    }
    if (session.blocked.length) await file({ kind: "bug", severity: "P2", title: "The app tried to reach an outside service during a sweep", evidence: [...new Set(session.blocked)].slice(0, 10).join("\n") });
    console.log(`   ${width} px: ${seen.size} screen(s)`);
    await session.close();
  }
  console.log(`   filed ${filed} new finding(s)`);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const agent of kit.agents) {
    if (roles && !roles.includes(agent.role)) continue;
    await sweepAgent(browser, agent).catch((error) => console.error(`   ${agent.label}: ${error.message}`));
  }
} finally {
  await browser.close();
}
