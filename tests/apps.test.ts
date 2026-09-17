import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FOREIGN_ORIGINS, verifiedOrigin } from "@/platform/config/app-origins";
import { staffRoles } from "@/platform/auth/permissions";
import {
  LINKABLE_PATHS,
  SCHOOL_APPS,
  appsFor,
  crossEnvironmentNotice,
  environmentLabel,
  schoolApp,
  studentLinkLabel,
} from "@/platform/config/apps";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

const STUDENT_ID = "11111111-2222-3333-4444-555555555555";

describe("the registry", () => {
  it("offers both siblings and only to the office and the admin", () => {
    expect(SCHOOL_APPS.map((app) => app.id).sort()).toEqual(["sampark", "schoolfees"]);

    expect(appsFor("admin").map((app) => app.id).sort()).toEqual([
      "sampark",
      "schoolfees",
    ]);
    expect(appsFor("office").map((app) => app.id).sort()).toEqual([
      "sampark",
      "schoolfees",
    ]);

    // PLAN §3: a teacher gets no fee cards, and neither coordinator has an
    // errand in either app. A launcher nobody needs is a tab nobody needs.
    for (const role of staffRoles) {
      if (role === "admin" || role === "office") continue;
      expect(appsFor(role), `${role} is offered a sibling app`).toEqual([]);
    }
  });

  it("builds every link from the verified origins", () => {
    for (const app of SCHOOL_APPS) {
      expect(app.origin).toBe(verifiedOrigin(app.id).origin);
      expect(app.home.href.startsWith(app.origin)).toBe(true);
      expect(app.environment).toBe(verifiedOrigin(app.id).environment);
    }
  });

  it("never builds a link on a hostname that is not ours", () => {
    const every = [
      ...SCHOOL_APPS.map((app) => app.home.href),
      ...SCHOOL_APPS.map((app) => app.student({ studentId: STUDENT_ID }, "dev").href),
      ...SCHOOL_APPS.map((app) => app.student({ search: "1234" }, "live").href),
    ];

    for (const href of every) {
      for (const foreign of FOREIGN_ORIGINS) {
        expect(href.startsWith(foreign), `${href} points at ${foreign}`).toBe(false);
      }
    }
  });

  it("refuses an app it does not have", () => {
    // @ts-expect-error — the guard is for ids that escape the type.
    expect(() => schoolApp("timetable2025")).toThrow(/no app registered/i);
  });
});

describe("a student link does not cross a dataset boundary", () => {
  const fees = schoolApp("schoolfees");

  it("opens the search screen when this app and the fee app hold different data", () => {
    // Which is the case today: VPPS One is on schoolfees-dev, the fee app is
    // live. An id from here would 404 there with a child's name on it.
    const link = fees.student({ studentId: STUDENT_ID, search: "1042" }, "dev");

    expect(link.kind).toBe("search");
    expect(link.href).not.toContain(STUDENT_ID);
    expect(link.href).toContain("/protected/students?query=1042");
  });

  it("opens the child when both sides are the same dataset", () => {
    const link = fees.student({ studentId: STUDENT_ID, search: "1042" }, "live");

    expect(link.kind).toBe("detail");
    expect(link.href).toBe(
      `${verifiedOrigin("schoolfees").origin}/protected/students/${STUDENT_ID}`,
    );
  });

  it("still opens the search screen with no id at all", () => {
    const link = fees.student({ search: "Kumari" }, "live");

    expect(link.kind).toBe("search");
    expect(link.href).toContain("query=Kumari");
  });

  it("omits an empty search rather than sending query=", () => {
    const link = fees.student({}, "live");

    expect(link.href).toBe(
      `${verifiedOrigin("schoolfees").origin}/protected/students`,
    );
  });

  it("escapes what it puts in the query", () => {
    const link = fees.student({ search: "a b&c=d" }, "live");
    const url = new URL(link.href);

    expect(url.searchParams.get("query")).toBe("a b&c=d");
    expect(url.pathname).toBe("/protected/students");
  });

  it("never deep-links a child into SamPark, whatever the environments say", () => {
    // SamPark keeps its own text ids. Mapping them to fee UUIDs is R3.1's job
    // (S-10), and guessing by name is the one thing PARITY.md forbids outright.
    const sampark = schoolApp("sampark");

    for (const from of ["dev", "live"] as const) {
      const link = sampark.student({ studentId: STUDENT_ID, search: "1042" }, from);
      expect(link.kind).toBe("search");
      expect(link.href).not.toContain(STUDENT_ID);
    }
  });

  it("labels the two kinds of link differently", () => {
    expect(studentLinkLabel("detail")).not.toEqual(studentLinkLabel("search"));
  });
});

describe("a badge describes its own destination", () => {
  it("does not let this app's test badge speak for a live one", () => {
    const fees = schoolApp("schoolfees");

    expect(fees.environment).toBe("live");
    expect(environmentLabel(fees.environment)).toEqual(environmentLabel("live"));
    expect(environmentLabel("live")).not.toEqual(environmentLabel("dev"));
  });

  it("warns when the data behind the link is not the data here", () => {
    const fees = schoolApp("schoolfees");

    expect(crossEnvironmentNotice("dev", fees)).not.toBeNull();
    expect(crossEnvironmentNotice("live", fees)).toBeNull();
  });
});

describe("nothing else writes a sibling hostname", () => {
  function walk(dir: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }

  const sources = walk(srcRoot).filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !file.endsWith(path.join("config", "app-origins.ts")) &&
      !file.endsWith(path.join("config", "apps.ts")),
  );

  it("finds the files it is supposed to be guarding", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it.each(sources.map((file) => [path.relative(repoRoot, file), file]))(
    "%s contains no vercel.app hostname",
    (_rel, file) => {
      // The whole point of the registry: one file knows the hostnames, because
      // two of the three a reader would guess are wrong (B-15).
      expect(readFileSync(file, "utf8")).not.toMatch(/https?:\/\/[\w-]+\.vercel\.app/);
    },
  );
});

describe("the allow-list is what gets linked", () => {
  it("has a path for every workflow R6 will need a destination for", () => {
    for (const expected of [
      "/protected/dashboard",
      "/protected/students",
      "/protected/payments",
      "/protected/transactions",
      "/protected/defaulters",
      "/protected/reminders",
      "/students",
      "/requests",
      "/review",
    ]) {
      expect(LINKABLE_PATHS).toContain(expected);
    }
  });

  it.each(LINKABLE_PATHS)("%s is a path, not a URL", (entry) => {
    expect(entry.startsWith("/")).toBe(true);
    expect(entry).not.toMatch(/^https?:/);
  });
});
