#!/usr/bin/env node
/**
 * Fetch every origin in `app-origins.ts` and check it is still itself.
 *
 *   npm run verify:origins
 *   npm run verify:origins -- --json > docs/evidence/origins-2026-09-17.json
 *
 * PLAN §2 says to verify origins from actual project metadata "before adding
 * them", and PARITY.md now records three. The risk is not that the table was
 * wrong when it was written — it is that a hostname moves, or that somebody
 * later writes `schoolfees.vercel.app` from memory and it happens to answer
 * 200. So "verified" has to be a command anybody can run again, not a sentence
 * in a document.
 *
 * It only ever issues GETs, and only to the three origins the school owns.
 * The two look-alike hostnames in `FOREIGN_ORIGINS` are deliberately **not**
 * fetched: they are other people's servers.
 *
 * Exit code is the result: 0 when every origin identified itself, 1 otherwise.
 */

import process from "node:process";

import {
  APP_IDS,
  FOREIGN_ORIGINS,
  VERIFIED_ORIGINS,
} from "../src/platform/config/app-origins.ts";

const asJson = process.argv.includes("--json");
const TIMEOUT_MS = 30_000;

/** Every case gets its own deadline, so one hung host cannot stall the run. */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "vppsone-verify-origins" },
    });
  } finally {
    clearTimeout(timer);
  }
}

function titleOf(html) {
  return html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
}

async function check(entry) {
  const url = `${entry.origin}${entry.probePath}`;
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(url);
    const body = await response.text();
    const elapsedMs = Date.now() - startedAt;
    const title = titleOf(body);
    const identified = body.includes(entry.identifiedBy);

    return {
      appId: entry.appId,
      origin: entry.origin,
      environment: entry.environment,
      url,
      status: response.status,
      finalUrl: response.url,
      title,
      identifiedBy: entry.identifiedBy,
      ok: response.ok && identified,
      // Two different failures, and the distinction matters when reading a
      // failed run: "nothing there" is a deploy problem, "something else
      // there" is the hostname trap B-15 records.
      reason: response.ok
        ? identified
          ? null
          : `answered ${response.status} but did not contain ${JSON.stringify(entry.identifiedBy)}`
        : `answered ${response.status}`,
      elapsedMs,
    };
  } catch (error) {
    return {
      appId: entry.appId,
      origin: entry.origin,
      environment: entry.environment,
      url,
      status: null,
      finalUrl: null,
      title: null,
      identifiedBy: entry.identifiedBy,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

// A run that checked nothing must not exit 0 — the same failure mode B-10
// records in the role smoke.
if (VERIFIED_ORIGINS.length !== APP_IDS.length) {
  console.error(
    `Refusing to run: ${VERIFIED_ORIGINS.length} origins recorded for ${APP_IDS.length} apps.`,
  );
  process.exit(1);
}

const results = await Promise.all(VERIFIED_ORIGINS.map(check));
const failed = results.filter((result) => !result.ok);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        expected: VERIFIED_ORIGINS.length,
        executed: results.length,
        failed: failed.length,
        notFetchedOnPurpose: FOREIGN_ORIGINS,
        results,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`${results.length} origins to verify\n`);

  for (const result of results) {
    const mark = result.ok ? "✓" : "✗";
    const label = result.appId.padEnd(11);
    const detail = result.ok
      ? `${result.status} · ${result.title ?? "(no title)"} · ${result.elapsedMs}ms`
      : result.reason;
    console.log(`${mark} ${label} ${result.environment.padEnd(4)} ${result.origin}`);
    console.log(`  ${detail}`);
  }

  console.log(
    `\n${results.length} checked, ${results.length - failed.length} identified, ${failed.length} failed.`,
  );

  if (failed.length > 0) {
    console.log(
      "\nAn origin that no longer identifies itself has moved or been taken over.",
    );
    console.log("Do not edit app-origins.ts from memory — re-resolve it from");
    console.log("`npx vercel project ls` and fetch the new host before trusting it.");
  }
}

process.exit(failed.length === 0 ? 0 : 1);
