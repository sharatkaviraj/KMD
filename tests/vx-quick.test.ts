import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { can, staffRoles, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { designMenuFor } from "@/vx/nav";
import { QUICK_CATALOGUE, quickFor, type QuickSet } from "@/vx/quick";
import { lastAction, registerLine, summariseRegisters } from "@/vx/shell/quick-logic";

/*
 * The "+" in the middle of every phone bar (D-643): each role's daily work,
 * never a screen that refuses the person, the teacher's register first.
 */

const as = (role: StaffRole) => (p: StaffPermission) => can({ role }, p);
const all = () => true;
const keys = (set: QuickSet | null) => [set?.hero?.key ?? null, ...(set?.tiles.map((t) => t.key) ?? [])];
const pagePath = (href: string) => path.resolve(process.cwd(), `src/app/(app)${href.split(/[?#]/)[0]}/page.tsx`);

describe("quickFor", () => {
  it("puts a class teacher's register first, with her day around it", () => {
    const set = quickFor("teacher", as("teacher"), { teacherHasClass: true })!;
    expect(set.hero?.href).toBe("/teach/attendance");
    expect(set.live).toBe("register");
    expect(set.layout).toBe("roomy");
    expect(set.tiles.map((t) => t.label.en)).toEqual(["Write a note", "Enter marks", "Needs you", "Ask for leave", "My timetable", "Notices"]);
    expect(set.help?.href).toBe("/teach/more?view=help");
  });

  it("gives a teacher without a class Enter marks on top, never a register that says no (UX review, 6 Nov)", () => {
    const set = quickFor("teacher", as("teacher"), { teacherHasClass: false })!;
    expect(set.hero?.href).toBe("/teach/marks");
    expect(set.live).toBeNull();
    expect(set.tiles.some((t) => t.href === "/teach/marks")).toBe(false);
    expect(set.tiles.some((t) => t.href === "/teach/attendance")).toBe(false);
  });

  it("gives the admin nine compact tiles in the order the office day uses them", () => {
    const set = quickFor("admin", as("admin"))!;
    expect(set.hero).toBeNull();
    expect(set.layout).toBe("compact");
    expect(set.tiles).toHaveLength(9);
    expect(set.tiles.slice(0, 3).map((t) => t.label.en)).toEqual(["Collect fee", "Attendance", "Send a notice"]);
    expect(set.search).toBe(true);
  });

  it("puts Collect fee first for the fee desk, and the cover for a coordinator", () => {
    expect(quickFor("accountant", as("accountant"))?.hero?.href).toBe("/payments");
    expect(quickFor("accountant", as("fee_collector"))?.hero?.href).toBe("/payments");
    expect(quickFor("academic", as("academic_coordinator"))?.hero?.href).toBe("/substitutions/arrange");
    expect(quickFor("exam", as("exam_coordinator"))?.hero?.href).toBe("/exams");
  });

  it("swaps the plain Substitute for Quick substitute when built-in AI may arrange cover", () => {
    const plain = quickFor("admin", all)!;
    const ai = quickFor("admin", all, { coverAi: true })!;
    expect(plain.coverAi).toBe(false);
    expect(plain.tiles.some((t) => t.href === "/substitutions/arrange")).toBe(true);
    expect(ai.coverAi).toBe(true);
    expect(ai.tiles.some((t) => t.href === "/substitutions/arrange")).toBe(false);
    // A coordinator's cover card becomes the AI row too, not a second way to the same page.
    const coordinator = quickFor("academic", all, { coverAi: true })!;
    expect(coordinator.hero).toBeNull();
    expect(coordinator.coverAi).toBe(true);
    // Without the permission to arrange cover, AI changes nothing.
    const noCover = (p: StaffPermission) => p !== "substitutions:manage";
    expect(quickFor("admin", noCover, { coverAi: true })?.coverAi).toBe(false);
  });

  it("never repeats the big card as a tile, and never holds more than a full grid", () => {
    for (const role of staffRoles) {
      const set = quickFor(designMenuFor(role), as(role), { teacherHasClass: true });
      if (!set) continue;
      expect(set.tiles.length, role).toBeLessThanOrEqual(set.layout === "compact" ? 9 : 6);
      const hrefs = set.tiles.map((t) => t.href);
      expect(new Set(hrefs).size, role).toBe(hrefs.length);
      if (set.hero) expect(hrefs, role).not.toContain(set.hero.href);
    }
  });

  it("is nothing at all for a reader it would hold nothing for", () => {
    expect(quickFor("admin", () => false)).toBeNull();
  });

  it("says every entry in both languages, with a line on what it does", () => {
    for (const role of staffRoles) {
      const set = quickFor(designMenuFor(role), all, { teacherHasClass: true, coverAi: false })!;
      for (const item of [set.hero, ...set.tiles, set.help].filter((x) => x !== null)) {
        expect(item.label.hi, `${role}:${item.key}`).toBeTruthy();
        expect(item.hint.en, `${role}:${item.key}`).toBeTruthy();
        expect(item.hint.hi, `${role}:${item.key}`).toBeTruthy();
      }
    }
  });
});

describe("the \"+\" never offers a screen that refuses the person", () => {
  it("has a page for every entry", () => {
    for (const entry of QUICK_CATALOGUE) expect(existsSync(pagePath(entry.href)), entry.href).toBe(true);
  });

  it("asks for at least every permission the page itself asks for", () => {
    for (const entry of QUICK_CATALOGUE) {
      const page = readFileSync(pagePath(entry.href), "utf8");
      const guards = [...page.matchAll(/requirePermission\("([a-z_:]+)"/g)].map((m) => m[1]);
      expect(guards.length, entry.href).toBeGreaterThan(0);
      for (const guard of guards) {
        // Asking for the stronger "mark" covers the register's "view" for every role that has it.
        const covered = entry.permissions.includes(guard as StaffPermission) || staffRoles.every((r) => !entry.permissions.every(as(r)) || as(r)(guard as StaffPermission));
        expect(covered, `${entry.key} ${entry.href} needs ${guard}`).toBe(true);
      }
    }
  });

  it("offers each role only what its own permissions open", () => {
    for (const role of staffRoles) {
      const set = quickFor(designMenuFor(role), as(role), { teacherHasClass: true });
      for (const item of [set?.hero, ...(set?.tiles ?? []), set?.help].filter((x) => x != null)) {
        const entry = QUICK_CATALOGUE.find((e) => e.href === item.href && e.key === item.key)!;
        expect(entry.permissions.every(as(role)), `${role}:${item.key}`).toBe(true);
      }
    }
  });

  it("gives a teacher no money", () => {
    expect(keys(quickFor("teacher", as("teacher"), { teacherHasClass: true }))).not.toContain("collect");
  });
});

describe("the register line under Mark attendance", () => {
  const label = (id: string) => ({ en: `Class ${id}`, hi: `कक्षा ${id}` });

  it("counts a register from its first save, and ignores a period register", () => {
    const status = summariseRegisters({
      open: true,
      held: ["5", "6"],
      registers: [
        { classId: "5", period: null, revision: 1, submittedAt: "2026-11-16T03:42:00Z" },
        { classId: "6", period: 2, revision: 3, submittedAt: "2026-11-16T04:00:00Z" },
      ],
      label,
    });
    expect(status).toEqual({
      state: "open",
      classes: [
        { label: label("5"), saved: true, savedAt: "2026-11-16T03:42:00Z" },
        { label: label("6"), saved: false, savedAt: null },
      ],
    });
    expect(registerLine(status)).toEqual({ line: { en: "1 of 2 classes still to mark", hi: "2 में से 1 कक्षाओं की हाज़िरी बाकी" }, tone: "warn" });
  });

  it("names the one class, and when it was saved", () => {
    const one = (saved: boolean) => summariseRegisters({ open: true, held: ["5"], registers: saved ? [{ classId: "5", period: null, revision: 2, submittedAt: "2026-11-16T03:42:00Z" }] : [], label });
    expect(registerLine(one(false))).toEqual({ line: { en: "Class 5 · Not marked yet", hi: "कक्षा 5 · अभी हाज़िरी नहीं लगी" }, tone: "warn" });
    const done = registerLine(one(true))!;
    expect(done.tone).toBe("ok");
    expect(done.line.en).toMatch(/^Class 5 · Done, saved .*9:12/);
  });

  it("says the school is closed on a holiday, and nothing at all when it does not know", () => {
    expect(registerLine(summariseRegisters({ open: false, held: ["5"], registers: [], label }))?.line.en).toBe("School is closed today");
    expect(registerLine(summariseRegisters({ open: true, held: [], registers: [], label }))).toBeNull();
    expect(registerLine(null)).toBeNull();
    expect(registerLine(undefined)).toBeNull();
  });

  it("says All done once every class is marked", () => {
    const status = summariseRegisters({
      open: true,
      held: ["5", "6"],
      registers: ["5", "6"].map((classId) => ({ classId, period: null, revision: 1, submittedAt: null })),
      label,
    });
    expect(registerLine(status)).toEqual({ line: { en: "All 2 classes done", hi: "सभी 2 कक्षाओं की हाज़िरी लग गई" }, tone: "ok" });
  });
});

describe("Last time", () => {
  const items = [
    { key: "collect", href: "/payments" },
    { key: "notice", href: "/messages?compose=1" },
  ];
  it("offers the last action again unless it is the big card or no longer offered", () => {
    expect(lastAction(items, "notice", null)?.key).toBe("notice");
    expect(lastAction(items, "collect", "/payments")).toBeNull();
    expect(lastAction(items, "gone", null)).toBeNull();
    expect(lastAction(items, null, null)).toBeNull();
  });
});
