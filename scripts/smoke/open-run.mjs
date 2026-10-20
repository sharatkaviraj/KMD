#!/usr/bin/env node
/**
 * Open a Smoke Lab run from a plan file, through the /smoke console as the QA
 * admin (the same screen and action a person uses), and save the agent kit.
 *
 *   APP_ORIGIN=https://vppsone.vercel.app node scripts/smoke/open-run.mjs plan.json
 *
 * plan.json: { "title", "schoolDay": "YYYY-MM-DD", "clockStart": "HH:MM",
 *              "hours": 8, "seats": [{ "key": "teacher3", "persona": "…" }] }
 *
 * The kit (it holds the passes) is written to `<SMOKE_RUN_DIR>/kit.json`,
 * default `.smoke-run/kit.json` — git-ignored, never commit it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "@playwright/test";

import { RUN_DIR } from "./session.mjs";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3200";
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const adminLink = (next) => execFileSync("node", ["scripts/dev-login.mjs", "admin", next], { env: { ...process.env, APP_ORIGIN: origin }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();

const browser = await chromium.launch({ headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
  await page.goto(adminLink("/smoke"), { waitUntil: "networkidle", timeout: 120_000 });
  if (new URL(page.url()).pathname !== "/smoke") throw new Error(`The QA admin did not reach /smoke (${page.url()}).`);

  const field = (name, tag = "input") => page.locator("label.field").filter({ has: page.locator("span", { hasText: new RegExp(`^${name}`) }) }).locator(tag).first();
  await field("Title").fill(plan.title);
  await field("Scenario", "select").selectOption("school_day");
  if (plan.schoolDay) await field("School day").fill(plan.schoolDay);
  if (plan.clockStart) await field("Clock starts at").fill(plan.clockStart);
  await field("Hours").fill(String(plan.hours ?? 8));

  const group = page.getByRole("group", { name: /test accounts/i });
  const boxes = group.getByRole("checkbox");
  for (let i = 0; i < (await boxes.count()); i += 1) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
  for (const seat of plan.seats) {
    const email = `smoke.${seat.key}@qa.vpps.local`;
    const row = group.locator(":scope > div").filter({ hasText: email });
    if ((await row.count()) !== 1) throw new Error(`No free row for ${email}.`);
    await row.getByRole("checkbox").check();
    if (seat.persona) await row.getByRole("textbox").fill(seat.persona.slice(0, 120));
  }
  await page.getByRole("button", { name: new RegExp(`Open run with ${plan.seats.length}`) }).click();
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: /Download agent kit/ }).click();
  const kit = JSON.parse(readFileSync(await (await download).path(), "utf8"));
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(path.join(RUN_DIR, "kit.json"), JSON.stringify(kit, null, 2));
  console.log(`run ${kit.runId} opened: ${kit.agents.length} seats; kit saved to ${path.join(RUN_DIR, "kit.json")}`);
} finally {
  await browser.close();
}
