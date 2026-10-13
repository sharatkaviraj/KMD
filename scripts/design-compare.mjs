#!/usr/bin/env node
/**
 * Set a screen beside the design's own frame, to check they are one picture.
 *
 *   npx vite --config tests/mobile-ui/design.vite.config.ts      # the fixture, port 3202
 *   node scripts/design-compare.mjs <out-dir> <spec> [<spec> ...]
 *
 * A spec is `name|query|frame|width|height`:
 *   name   file name for the result
 *   query  the fixture's query string (`view=student360&path=/students/x`)
 *   frame  a design frame under docs/design-handoff/screenshots (`final/F06-Student360.webp`), or `-`
 *   width/height  the viewport, e.g. 390|844 or 1440|900
 *
 * Writes `<out-dir>/<name>.png`: the design frame on the left, the app on the
 * right, both at the same size. Synthetic data only; nothing signs in.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || specs.length === 0) {
  console.error("usage: node scripts/design-compare.mjs <out-dir> 'name|query|frame|width|height' ...");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const origin = process.env.FIXTURE_ORIGIN ?? "http://127.0.0.1:3202";
const shots = path.resolve("docs/design-handoff/screenshots");

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  for (const spec of specs) {
    const [name, query, frame, w, h] = spec.split("|");
    const width = Number(w) || 1440;
    const height = Number(h) || 900;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${origin}/design.html?${query}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    const appShot = path.join(outDir, `${name}.app.png`);
    await page.screenshot({ path: appShot });
    await page.close();

    const out = path.join(outDir, `${name}.png`);
    if (frame && frame !== "-") {
      const compose = await browser.newPage({ viewport: { width: width * 2 + 24, height: height + 28 }, deviceScaleFactor: 1 });
      const left = pathToFileURL(path.join(shots, frame)).href;
      const right = pathToFileURL(path.resolve(appShot)).href;
      await compose.setContent(`<body style="margin:0;background:#888;font:12px system-ui;color:#fff">
        <div style="display:flex;gap:24px"><div><div style="height:28px;line-height:28px">design · ${frame}</div><img src="${left}" style="width:${width}px;height:${height}px;object-fit:cover;object-position:top;display:block;background:#fff"></div>
        <div><div style="height:28px;line-height:28px">app · ${query}</div><img src="${right}" style="width:${width}px;height:${height}px;display:block"></div></div></body>`);
      await compose.waitForTimeout(300);
      await compose.screenshot({ path: out });
      await compose.close();
    }
    console.log(`${name}: ${out}${errors.length ? `\n  errors: ${errors.slice(0, 5).join(" | ")}` : ""}`);
  }
} finally {
  await browser.close();
}
