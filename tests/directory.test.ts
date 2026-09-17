import { describe, expect, it } from "vitest";

import {
  PAGE_SIZE,
  directoryHref,
  isFiltered,
  normaliseQuery,
  pageWindow,
  queryKind,
  resolvePage,
} from "@/modules/students/domain/directory";

/**
 * What a typed query means, and what a page of results looks like.
 *
 * The rules that matter are the ones about *not* matching: an admission number
 * is exact, so typing "12" must not return every child whose SR contains a 12.
 */

describe("what was typed", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["Meera", "name"],
    ["meera sharma", "name"],
    ["शर्मा", "name"],
    ["1042", "admission"],
    ["7", "admission"],
    ["9812345670", "phone"],
    ["98123 45670", "phone"],
    ["98123-45670", "phone"],
  ] as const)("%o is a %s", (text, expected) => {
    expect(queryKind(text)).toBe(expected);
  });

  it("treats a long run of digits as a name, not a phone number", () => {
    // Eleven digits is not an Indian mobile, and guessing that it is would
    // silently return nothing for a query somebody could have fixed.
    expect(queryKind("98123456701")).toBe("name");
  });

  it("collapses whitespace so a pasted name still matches", () => {
    expect(normaliseQuery("  Meera   Sharma  ")).toBe("Meera Sharma");
    expect(normaliseQuery("   ")).toBe("");
  });
});

describe("which page", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["1", 1],
    ["3", 3],
    // A URL is typed, bookmarked and shared, so all of these arrive.
    ["0", 1],
    ["-2", 1],
    ["banana", 1],
    ["1.5", 1],
  ])("?page=%s is page %i", (raw, expected) => {
    expect(resolvePage(raw as string | undefined)).toBe(expected);
  });
});

describe("the page window", () => {
  it("counts rows from one, not from zero", () => {
    // "0–49 of 139" is the bug this exists to stop.
    const first = pageWindow(1, 139);

    expect(first.firstRow).toBe(1);
    expect(first.lastRow).toBe(PAGE_SIZE);
    expect(first.from).toBe(0);
    expect(first.to).toBe(PAGE_SIZE - 1);
  });

  it("stops the last page at the last row", () => {
    const last = pageWindow(3, 139);

    expect(last.page).toBe(3);
    expect(last.pages).toBe(3);
    expect(last.firstRow).toBe(101);
    expect(last.lastRow).toBe(139);
  });

  it("clamps a page past the end rather than showing an empty list", () => {
    expect(pageWindow(99, 139).page).toBe(3);
  });

  it("says 0–0 of 0 rather than 1–50 when there is nothing", () => {
    const none = pageWindow(1, 0);

    expect(none.firstRow).toBe(0);
    expect(none.lastRow).toBe(0);
    expect(none.pages).toBe(1);
  });

  it("is one page when the roll fits on one", () => {
    expect(pageWindow(1, PAGE_SIZE).pages).toBe(1);
    expect(pageWindow(1, PAGE_SIZE + 1).pages).toBe(2);
  });
});

describe("the URL is the state", () => {
  it("writes only what is actually filtered", () => {
    // `?q=&class=&page=1` says nothing, three times.
    expect(directoryHref({ text: "", classId: null, page: 1 })).toBe("/students");
  });

  it("keeps a search, a class and a page", () => {
    const href = directoryHref({ text: "Meera", classId: "c1", page: 2 });
    const url = new URL(href, "https://example.test");

    expect(url.pathname).toBe("/students");
    expect(url.searchParams.get("q")).toBe("Meera");
    expect(url.searchParams.get("class")).toBe("c1");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("escapes what it puts in the query", () => {
    const url = new URL(
      directoryHref({ text: "a&b c", page: 1 }),
      "https://example.test",
    );

    expect(url.searchParams.get("q")).toBe("a&b c");
  });

  it("drops page 1, because it is the page you get anyway", () => {
    expect(directoryHref({ text: "Meera", page: 1 })).toBe("/students?q=Meera");
  });

  it("round-trips through resolvePage", () => {
    const href = directoryHref({ text: "x", page: 4 });
    const url = new URL(href, "https://example.test");

    expect(resolvePage(url.searchParams.get("page") ?? undefined)).toBe(4);
  });
});

describe("whether anything is filtering the list", () => {
  it("is false for a bare list", () => {
    expect(isFiltered({ text: "", classId: null, page: 1 })).toBe(false);
    expect(isFiltered({ text: "   ", classId: null, page: 3 })).toBe(false);
  });

  it("is true for a search or a class", () => {
    expect(isFiltered({ text: "Meera", classId: null, page: 1 })).toBe(true);
    expect(isFiltered({ text: "", classId: "c1", page: 1 })).toBe(true);
  });
});

describe("an alphanumeric SR is a label, not a number", () => {
  it("does not take TEST-CL6-002 for a bare admission number", () => {
    // This school issues alphanumeric SRs. The exact-match branch only sees
    // bare digits, so an SR with letters has to fall to the loose branch —
    // which searches `admission_no` alongside the names for exactly this
    // reason. Getting it wrong means a pasted SR finds nothing, which reads as
    // "that child is not here".
    expect(queryKind("TEST-CL6-002")).toBe("name");
    expect(queryKind("SR-2026-14")).toBe("name");
  });

  it("still treats a bare number as an exact admission number", () => {
    expect(queryKind("002")).toBe("admission");
    expect(queryKind("1042")).toBe("admission");
  });

  it("keeps the repo's loose branch searching the admission number", async () => {
    // The rule lives in the query the repo builds, so this reads it rather
    // than asserting a shape the domain cannot see.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      "src/modules/students/data/directory-repo.ts",
      "utf8",
    );

    expect(source).toMatch(/kind === "name"[\s\S]{0,600}?admission_no\.ilike/);
  });
});
