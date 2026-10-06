#!/usr/bin/env node
/**
 * How many database round trips does each screen wait on, one after another?
 *
 * A page's server time is mostly network: the functions run in one region and
 * Supabase answers from another, so each *sequential* round trip costs one
 * inter-region RTT whatever the query does. This counts them.
 *
 *   # terminal 1 — a production build with the tracer loaded (PowerShell)
 *   $env:NODE_OPTIONS = "--import ./scripts/trace-fetch.mjs"
 *   $env:TRACE_FETCH_FILE = "$env:TEMP\vpps-trace.jsonl"
 *   npm run start -- -p 3400
 *
 *   # terminal 2
 *   $env:APP_ORIGIN = "http://localhost:3400"
 *   $env:TRACE_FETCH_FILE = "$env:TEMP\vpps-trace.jsonl"
 *   node scripts/measure-round-trips.mjs --write docs/evidence/round-trips.json
 *
 * For every (account, path) it signs in once through `/auth/confirm` with a
 * one-time QA link (the door `npm run dev:login` uses; QA addresses only, dev
 * only), loads the page twice to warm it, then loads it `SAMPLES` times one at
 * a time and attributes each traced Supabase request to the load it fell in.
 *
 * Reported per page, as medians:
 *   - `calls`  — Supabase requests made while rendering the document
 *   - `depth`  — the longest chain of those that waited on each other: the
 *                number of round trips on the critical path
 *   - `serverMs` — the full document load as this machine sees it
 *
 * `depth × RTT` is what moving the server next to the database removes, and
 * what parallelising a waterfall removes everywhere.
 */
import { readFileSync, writeFileSync, existsSync, truncateSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { isDevProjectUrl } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);

if (!isDevProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error("Refusing to run: .env.local is not the dev project (rule 3).");
  process.exit(1);
}

const origin = process.env.APP_ORIGIN ?? "http://localhost:3400";
const traceFile = process.env.TRACE_FETCH_FILE;
if (!traceFile) {
  console.error("Set TRACE_FETCH_FILE to the file the server's tracer writes.");
  process.exit(1);
}

const SAMPLES = Number(process.env.SAMPLES ?? 5);
const supabaseOrigin = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;

/** The screens each role opens most, by role Home and the PLAN's daily flows. */
const PAGES = [
  ["teacher", "/teach"],
  ["teacher", "/teach/attendance"],
  ["admin", "/dashboard"],
  ["admin", "/students"],
  ["admin", "/timetable"],
  ["admin", "/substitutions"],
  ["office", "/collection"],
  ["accountant", "/fees/dashboard"],
  ["accountant", "/fees/payments"],
  ["accountant", "/fees/transactions"],
  ["accountant", "/fees/defaulters"],
  [null, "/r/not-a-real-token-0000000000"],
];

const { QA_ACCOUNTS } = await import("../tests/fixtures/qa-accounts.ts");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function sessionCookie(key) {
  const account = QA_ACCOUNTS.find((candidate) => candidate.key === key);
  if (!account?.email.endsWith("@qa.vpps.local")) throw new Error(`${key}: not a QA account`);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: account.email });
  if (error) throw new Error(`${key}: ${error.message}`);
  const response = await fetch(
    `${origin}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`,
    { redirect: "manual" },
  );
  const cookies = response.headers.getSetCookie().map((line) => line.split(";")[0]);
  if (!cookies.some((cookie) => cookie.startsWith("sb-"))) throw new Error(`${key}: no session cookie`);
  return cookies.join("; ");
}

async function load(pathname, cookie) {
  const start = Date.now();
  const response = await fetch(origin + pathname, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  await response.arrayBuffer();
  return { start, end: Date.now(), status: response.status };
}

/** Longest chain of requests where each started after the previous finished. */
function criticalDepth(requests) {
  const sorted = [...requests].sort((a, b) => a.start - b.start);
  const depth = [];
  sorted.forEach((request, i) => {
    let best = 0;
    for (let j = 0; j < i; j++) if (sorted[j].end <= request.start + 1) best = Math.max(best, depth[j]);
    depth.push(best + 1);
  });
  return Math.max(0, ...depth);
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function traced() {
  return existsSync(traceFile)
    ? readFileSync(traceFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
}

/*
 * `--timeline <account> <path>`: one warm load, every Supabase call in it with
 * its start and end offset — which call waited on which. The tool for finding
 * a waterfall once the table above has said where one is.
 */
const timeline = process.argv.indexOf("--timeline");
if (timeline !== -1) {
  const [role, pathname] = process.argv.slice(timeline + 1);
  const cookie = await sessionCookie(role);
  await load(pathname, cookie);
  await load(pathname, cookie);
  if (existsSync(traceFile)) truncateSync(traceFile, 0);
  const page = await load(pathname, cookie);
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log(`${role} ${pathname}: ${page.status} in ${page.end - page.start} ms`);
  for (const request of traced()
    .filter((request) => request.origin === supabaseOrigin && request.start >= page.start && request.end <= page.end)
    .sort((a, b) => a.start - b.start)) {
    const at = (ms) => String(Math.round(ms - page.start)).padStart(5);
    console.log(`${at(request.start)} ${at(request.end)}  ${request.method.padEnd(5)} ${request.path}`);
  }
  process.exit(0);
}

const cookies = new Map();
const results = [];
for (const [role, pathname] of PAGES) {
  if (role && !cookies.has(role)) cookies.set(role, await sessionCookie(role));
  const cookie = role ? cookies.get(role) : null;
  await load(pathname, cookie);
  await load(pathname, cookie);

  if (existsSync(traceFile)) truncateSync(traceFile, 0);
  const loads = [];
  for (let i = 0; i < SAMPLES; i++) loads.push(await load(pathname, cookie));
  await new Promise((resolve) => setTimeout(resolve, 300));

  const requestsSeen = traced();
  const samples = loads.map((page) => {
    const requests = requestsSeen.filter(
      (request) => request.origin === supabaseOrigin && request.start >= page.start && request.end <= page.end,
    );
    return { status: page.status, ms: page.end - page.start, calls: requests.length, depth: criticalDepth(requests) };
  });
  const row = {
    role: role ?? "public",
    path: pathname.startsWith("/r/") ? "/r/[unknown token]" : pathname,
    status: samples[0].status,
    calls: median(samples.map((sample) => sample.calls)),
    depth: median(samples.map((sample) => sample.depth)),
    serverMs: median(samples.map((sample) => sample.ms)),
  };
  results.push(row);
  console.log(`${row.role.padEnd(10)} ${row.path.padEnd(22)} ${row.status}  calls ${String(row.calls).padStart(3)}  depth ${String(row.depth).padStart(2)}  ${row.serverMs} ms`);
}

const output = process.argv.indexOf("--write");
if (output !== -1) {
  writeFileSync(
    process.argv[output + 1],
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        origin,
        samples: SAMPLES,
        method:
          "Local production build, traced with scripts/trace-fetch.mjs. calls and depth count Supabase requests during one document load; depth is the critical path. serverMs is this machine's load time, not production's.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
