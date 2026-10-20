#!/usr/bin/env node
/**
 * Prove the Smoke Lab works end to end against a running app on the test
 * database, the way a person and an agent use it:
 *
 *   APP_ORIGIN=http://localhost:3200 node scripts/smoke/self-test.mjs
 *
 * 1. The QA admin opens /smoke and opens a run for two seats (UI, real action).
 * 2. The agent kit is downloaded; seat A signs in with its pass, reads its
 *    brief, files a finding (and a repeat of it).
 * 3. The admin revokes seat A's pass: A's next request is signed out to
 *    /lab/ended, and its pass is refused by the API. Seat B still works.
 * 4. The admin revokes the run: B is signed out too.
 * Writes only the lab's own rows (one run, two passes, one finding).
 */

import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

import { chromium } from "@playwright/test";

import { brief, fileFinding, openAgent } from "./lib.mjs";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3200";
const adminLink = (next) => execFileSync("node", ["scripts/dev-login.mjs", "admin", next], { env: { ...process.env, APP_ORIGIN: origin }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();

const browser = await chromium.launch({ headless: true });
const step = (s) => console.log(`- ${s}`);
try {
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
  await admin.goto(adminLink("/smoke"), { waitUntil: "networkidle", timeout: 120_000 });
  assert.equal(new URL(admin.url()).pathname, "/smoke", "admin reaches /smoke");
  step("admin reached /smoke");

  const title = `Self-test ${new Date().toISOString().slice(0, 16)}`;
  await admin.getByLabel("Title").fill(title);
  const boxes = admin.getByRole("group", { name: /test accounts/i }).getByRole("checkbox");
  const count = await boxes.count();
  for (let i = 0; i < count; i += 1) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
  let picked = 0;
  for (let i = 0; i < count && picked < 2; i += 1) {
    if (await boxes.nth(i).isEnabled()) {
      await boxes.nth(i).check();
      picked += 1;
    }
  }
  assert.equal(picked, 2, "two free seats to test with");
  await admin.getByRole("button", { name: /Open run with 2/ }).click();
  const download = admin.waitForEvent("download");
  await admin.getByRole("button", { name: /Download agent kit/ }).click();
  const kit = JSON.parse(readFileSync(await (await download).path(), "utf8"));
  assert.equal(kit.agents.length, 2);
  step(`run opened, kit has ${kit.agents.map((a) => a.label).join(" and ")}`);

  const [a, b] = kit.agents;
  const agentA = await openAgent(origin, a.pass, { browser });
  assert.notEqual(new URL(agentA.page.url()).pathname, "/login", "A is signed in");
  step(`A signed in and landed on ${new URL(agentA.page.url()).pathname}`);
  const briefA = await brief(origin, a.pass);
  assert.equal(briefA.account.email, a.email);
  step(`A's brief: ${briefA.yourSteps.length} step(s) for ${briefA.account.role}`);
  const filed = await fileFinding(origin, a.pass, { kind: "question", severity: "P3", title: "Self-test finding, safe to mark not a bug", screen: "/smoke" });
  const again = await fileFinding(origin, a.pass, { kind: "question", severity: "P3", title: "Self-test finding, safe to mark not a bug", screen: "/smoke" });
  assert.ok(filed?.id && again?.repeat === true && again.id === filed.id, "a repeat raises the count instead of a new row");
  step("finding filed, repeat counted");

  const agentB = await openAgent(origin, b.pass, { browser });
  step("B signed in");

  await admin.goto(`${origin}/smoke`, { waitUntil: "networkidle" });
  await admin.getByRole("button", { name: new RegExp(`Revoke ${a.label}`) }).click();
  await admin.waitForTimeout(1500);
  await agentA.page.goto(`${origin}/`, { waitUntil: "networkidle" });
  assert.match(new URL(agentA.page.url()).pathname, /^\/lab\/ended/, "A is signed out after its pass is revoked");
  await assert.rejects(brief(origin, a.pass), /refused/);
  step("revoking A's pass signed A out and its pass is refused");

  await agentB.page.goto(`${origin}/`, { waitUntil: "networkidle" });
  assert.doesNotMatch(new URL(agentB.page.url()).pathname, /^\/lab\/ended|^\/login/, "B still works");
  const run = admin.locator("div", { hasText: title }).getByRole("button", { name: "Revoke now" }).first();
  await run.click();
  await admin.waitForTimeout(1500);
  await agentB.page.goto(`${origin}/`, { waitUntil: "networkidle" });
  assert.match(new URL(agentB.page.url()).pathname, /^\/lab\/ended/, "B is signed out after the run is revoked");
  step("revoking the run signed B out");

  assert.deepEqual([...agentA.blocked, ...agentB.blocked], [], "no request left the app");
  console.log("\nSMOKE LAB SELF-TEST PASSED");
} finally {
  await browser.close();
}
