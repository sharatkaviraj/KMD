import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { staffRoles, type StaffRole } from "@/platform/auth/permissions";
import {
  ROUTE_EXPECTATIONS,
  differenceFor,
  expectationFor,
  productAllows,
} from "./fixtures/role-expectations";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.join(repoRoot, "src/app/(app)");

/** Every guarded screen, as a route — the same walk `smoke:roles` does. */
function screens(): string[] {
  const found: string[] = [];

  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${route}/${entry.name}`);
      else if (entry.name === "page.tsx") found.push(route === "" ? "/" : route);
    }
  };

  walk(appRoot, "");
  return found.sort();
}

const routes = screens();

describe("the product expectation covers the app", () => {
  it("finds the screens it is supposed to be covering", () => {
    // A walk that matches nothing is a test that always passes (D-96).
    expect(routes.length).toBeGreaterThan(20);
  });

  it.each(routes)("%s has a product expectation", (route) => {
    // A screen with no row here is a screen nobody decided the access rules
    // for, and `smoke:roles` would throw rather than quietly checking less.
    expect(() => expectationFor(route)).not.toThrow();
  });

  it("has no expectation for a screen that does not exist", () => {
    const orphans = ROUTE_EXPECTATIONS.map((entry) => entry.route).filter(
      (route) => !routes.includes(route),
    );

    expect(orphans, "expectations for screens that were removed").toEqual([]);
  });

  it.each(ROUTE_EXPECTATIONS.map((entry) => [entry.route, entry] as const))(
    "%s says which roles and why",
    (_route, entry) => {
      expect(entry.allow.length, "a screen nobody may open is a deleted screen").toBeGreaterThan(0);
      expect(entry.because.length, "an expectation with no reason is a guess").toBeGreaterThan(15);

      for (const role of entry.allow) {
        expect(staffRoles).toContain(role);
      }
      expect(new Set(entry.allow).size).toBe(entry.allow.length);
    },
  );

  it("gives admin every screen", () => {
    // Admin is "everything" by construction in `permissions.ts`; an expectation
    // that quietly disagrees would fail 36 combinations at once and look like a
    // code bug.
    for (const route of routes) {
      expect(productAllows(route, "admin"), `admin cannot open ${route}`).toBe(true);
    }
  });
});

describe("a disagreement has to be owned", () => {
  const withDifference = ROUTE_EXPECTATIONS.filter((entry) => entry.difference);

  it("still has the one it was written for", () => {
    // If this reaches zero, R1.2 has resolved the viewer's reach and
    // `smoke:roles -- --strict` should become the default.
    expect(withDifference.length).toBeGreaterThan(0);
  });

  it.each(withDifference.map((entry) => [entry.route, entry.difference!] as const))(
    "%s names an owner and what it is",
    (_route, difference) => {
      expect(difference.owner).toMatch(/[A-Z]-\d+|R\d/);
      expect(difference.note.length).toBeGreaterThan(30);
      expect(difference.roles.length).toBeGreaterThan(0);
    },
  );

  it("only excuses the direction it describes", () => {
    const viewer: StaffRole = "view_only";
    const route = "/teach/attendance";

    // The implementation allowing what the product denies is the recorded case.
    expect(differenceFor(route, viewer, true)).not.toBeNull();
    // The reverse would be a different bug and is not excused by this row.
    expect(differenceFor(route, viewer, false)).toBeNull();
  });

  it("does not excuse a role it does not name", () => {
    expect(differenceFor("/teach/attendance", "teacher", false)).toBeNull();
  });

  it("returns nothing when the two readings agree", () => {
    expect(differenceFor("/jobs", "admin", true)).toBeNull();
  });
});

describe("the runners read this file", () => {
  it("smoke:roles compares against the product expectation", () => {
    const smoke = readFileSync(path.join(repoRoot, "scripts/smoke-roles.mjs"), "utf8");

    expect(smoke).toMatch(/from "\.\.\/tests\/fixtures\/role-expectations\.ts"/);
    expect(smoke).toMatch(/productAllows\(/);
    expect(smoke).toMatch(/differenceFor\(/);
  });

  it("smoke:roles refuses to report a pass on a short run", () => {
    const smoke = readFileSync(path.join(repoRoot, "scripts/smoke-roles.mjs"), "utf8");

    // B-10: the count used to be incremented and never compared to anything.
    expect(smoke).toMatch(/report\.executed !== report\.expected/);
    expect(smoke).toMatch(/CASE_TIMEOUT_MS/);
  });
});

