#!/usr/bin/env node
/*
 * `next build --webpack` with room for the typecheck.
 *
 * Next runs "Running TypeScript" in a worker that inherits NODE_OPTIONS, and a
 * Vercel build sets none, so the worker gets Node's default heap (about 2 GB on
 * the 8 GB build machine). A cold check of this repo needs about 3.8 GB: on
 * 6 Nov 2026 a preview build sat in "Running TypeScript" until it timed out and
 * held up every deploy queued behind it. CI already gives the check 6 GB
 * (.github/workflows/ci.yml); this gives the build the same, unless the caller
 * set a heap size of their own. Works the same on Windows, where an inline
 * `NODE_OPTIONS=… next build` would not.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const HEAP_MB = 6144;
const current = process.env.NODE_OPTIONS ?? "";
const nodeOptions = /--max[-_]old[-_]space[-_]size/.test(current)
  ? current
  : `${current} --max-old-space-size=${HEAP_MB}`.trim();

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "build", "--webpack", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
