import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_IDS,
  FOREIGN_ORIGINS,
  VERIFIED_ORIGINS,
  idsTravelBetween,
  verifiedOrigin,
} from "@/platform/config/app-origins";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * These tests do not reach the network — `npm run verify:origins` does that.
 * What they hold in place is the part a network check cannot: that nobody
 * later edits this table to a hostname that merely looks right.
 */

describe("the verified origin table", () => {
  it("covers every app id exactly once", () => {
    expect(VERIFIED_ORIGINS.map((entry) => entry.appId).sort()).toEqual(
      [...APP_IDS].sort(),
    );
  });

  it.each(VERIFIED_ORIGINS.map((entry) => [entry.appId, entry]))(
    "%s is an https origin with no path and no trailing slash",
    (_id, entry) => {
      const url = new URL(entry.origin);
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toBe("/");
      expect(entry.origin.endsWith("/")).toBe(false);
      expect(entry.origin).toBe(`${url.protocol}//${url.host}`);
    },
  );

  it.each(VERIFIED_ORIGINS.map((entry) => [entry.appId, entry]))(
    "%s names something to look for, not just a status code",
    (_id, entry) => {
      expect(entry.identifiedBy.trim().length).toBeGreaterThan(3);
      expect(entry.probePath.startsWith("/")).toBe(true);
      expect(entry.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
  );

  /**
   * B-15. `schoolfees.vercel.app` answers 200 and belongs to a different
   * product; `sampark.vercel.app` is not ours either. Both are the hostname a
   * reader would guess, so guessing has to fail the build.
   */
  it.each(FOREIGN_ORIGINS)("never points at %s", (foreign) => {
    expect(VERIFIED_ORIGINS.map((entry) => entry.origin)).not.toContain(foreign);
  });

  it("does not let the fee app and VPPS One share a hostname", () => {
    const hosts = VERIFIED_ORIGINS.map((entry) => new URL(entry.origin).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("refuses an app id it has no origin for", () => {
    // @ts-expect-error — the guard exists for ids that escape the type.
    expect(() => verifiedOrigin("timetable2025")).toThrow(/no verified origin/i);
  });
});

describe("ids do not travel between datasets", () => {
  it("keeps a dev id out of a live URL", () => {
    expect(idsTravelBetween("dev", "live")).toBe(false);
    expect(idsTravelBetween("live", "dev")).toBe(false);
  });

  it("allows a deep link when both sides are the same dataset", () => {
    expect(idsTravelBetween("dev", "dev")).toBe(true);
    expect(idsTravelBetween("live", "live")).toBe(true);
  });

  /**
   * Today VPPS One is on dev and both siblings are on live, so no deep link
   * may carry a student id. If that ever changes — a fee test origin appears,
   * or VPPS One cuts over — this test fails and the fallback in R1.1 gets
   * reconsidered deliberately rather than silently starting to work.
   */
  it("records that no sibling link may carry an id today", () => {
    const vppsone = verifiedOrigin("vppsone");
    const siblings = VERIFIED_ORIGINS.filter((entry) => entry.appId !== "vppsone");

    expect(siblings).toHaveLength(2);
    for (const sibling of siblings) {
      expect(idsTravelBetween(vppsone.environment, sibling.environment)).toBe(false);
    }
  });
});

describe("the register and the code agree", () => {
  const parity = readFileSync(path.join(repoRoot, "docs/PARITY.md"), "utf8");

  it.each(VERIFIED_ORIGINS.map((entry) => [entry.appId, entry.origin]))(
    "PARITY.md records %s at %s",
    (_id, origin) => {
      expect(parity).toContain(origin);
    },
  );

  it.each(FOREIGN_ORIGINS)("PARITY.md warns about %s", (foreign) => {
    expect(parity).toContain(foreign);
  });
});
