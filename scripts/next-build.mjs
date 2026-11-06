#!/usr/bin/env node
/*
 * `next build --webpack` with room for the typecheck.
 *
 * Next runs "Running TypeScript" in a worker that inherits NODE_OPTIONS. A cold
 * check of this repo needs about 3.8 GB, more than Node's default heap, so off
 * Vercel (CI, a laptop) this gives the build 6 GB, the same as CI's `types` job,
 * unless the caller set a heap size of their own.
 *
 * On Vercel it adds nothing: next.config.ts skips the build's type check there
 * (CI is the gate). The 8 GB build machine cannot hold webpack's process and a
 * 6 GB checker at once; a01a427 was SIGKILLed for trying, on 6 Nov 2026.
 * Works the same on Windows, where an inline `NODE_OPTIONS=… next build`
 * would not.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const HEAP_MB = 6144;
const current = process.env.NODE_OPTIONS ?? "";
const onVercel = process.env.VERCEL === "1";
const nodeOptions = onVercel || /--max[-_]old[-_]space[-_]size/.test(current)
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
