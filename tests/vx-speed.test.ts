import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { schoolToday } from "@/vx/format";
import { weekBars } from "@/vx/screens/admin/today-logic";
import { inboxBadgeCount, SUBMISSION_ITEMS_MAX } from "@/vx/shell/badge-count";
import { isChunkLoadError, reloadOnceForChunk } from "@/vx/shell/chunk-reload";
import { inMarkingWindow } from "@/vx/shell/prefetch-window";
import { menuRoleLabel } from "@/vx/shell/role-line";

const root = path.resolve(__dirname, "..");
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("the Needs you badge counts what the list shows (perf 2)", () => {
  it("counts one item for unmarked registers and one for all confirmations", () => {
    expect(inboxBadgeCount({ notMarked: true, coverNeeded: 2, changes: 3, confirmations: 9, refunds: 1, failedJobs: 1 })).toBe(1 + 2 + 3 + 1 + 1 + 1);
  });

  it("caps field changes where the list caps them", () => {
    expect(inboxBadgeCount({ notMarked: false, coverNeeded: 0, changes: 75, confirmations: 0, refunds: 0, failedJobs: 0 })).toBe(SUBMISSION_ITEMS_MAX);
  });

  it("is nought when nothing waits", () => {
    expect(inboxBadgeCount({ notMarked: false, coverNeeded: 0, changes: 0, confirmations: 0, refunds: 0, failedJobs: 0 })).toBe(0);
  });
});

describe("whose app the sidebar names (admin B6)", () => {
  it("names the view-only account and the office by their own role, not as the admin", () => {
    expect(menuRoleLabel("admin", "view_only", null).en).toBe("View only");
    expect(menuRoleLabel("admin", "office", null).en).toBe("Office");
  });

  it("keeps the admin's and every other menu's own name", () => {
    expect(menuRoleLabel("admin", "admin", null).en).toBe("Admin");
    expect(menuRoleLabel("teacher", "teacher", null).en).toBe("Teacher");
    expect(menuRoleLabel("accountant", "admin", "accountant").en).toBe("Accounts");
  });
});

describe("a chunk that did not arrive reloads once (coordinators B10, BUG-12)", () => {
  it("recognises webpack's and the browser's chunk failures, and nothing else", () => {
    expect(isChunkLoadError(Object.assign(new Error("Loading chunk 6325 failed.\n(timeout: …)"), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 6325 failed. (timeout: http://x/_next/static/chunks/6325.js)"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk app-layout failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Could not read the registers"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  function tab() {
    const store = new Map<string, string>();
    return {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      location: { reload: vi.fn() },
    };
  }

  it("reloads the first time, not again within a minute, and again after one", () => {
    const t = tab();
    expect(reloadOnceForChunk(t, 1_000_000)).toBe(true);
    expect(reloadOnceForChunk(t, 1_030_000)).toBe(false);
    expect(reloadOnceForChunk(t, 1_061_000)).toBe(true);
    expect(t.location.reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads without storage, so a dead network cannot loop", () => {
    const reload = vi.fn();
    const broken = { sessionStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => {} }, location: { reload } };
    expect(reloadOnceForChunk(broken)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("is wired into both error boundaries, which speak through the message pairs", () => {
    for (const file of ["src/app/(app)/error.tsx", "src/app/global-error.tsx"]) {
      const text = source(file);
      expect(text).toContain("reloadOnceForChunk(window)");
      expect(text).toContain("m.pageNotLoaded");
    }
  });
});

describe("the teacher's register is warmed only in the marking hours (perf 9)", () => {
  it("follows the school's clock, 08:00 to 10:30 IST", () => {
    expect(inMarkingWindow(new Date("2026-10-15T02:29:00Z"))).toBe(false); // 07:59 IST
    expect(inMarkingWindow(new Date("2026-10-15T02:30:00Z"))).toBe(true); // 08:00 IST
    expect(inMarkingWindow(new Date("2026-10-15T04:59:00Z"))).toBe(true); // 10:29 IST
    expect(inMarkingWindow(new Date("2026-10-15T05:00:00Z"))).toBe(false); // 10:30 IST
    expect(inMarkingWindow(new Date("2026-10-14T20:00:00Z"))).toBe(false); // 01:30 IST
  });

  it("uses intent links on the bottom bar", () => {
    const bar = source("src/vx/shell/bottom-bar.tsx");
    expect(bar).toContain("<IntentLink");
    expect(bar).toContain('router.prefetch(REGISTER');
  });
});

describe("first-load JS (perf 3, 8)", () => {
  it("the session-expired sheet does not import supabase-js statically", () => {
    const sheet = source("src/vx/screens/system/session-expired.tsx");
    expect(sheet).not.toMatch(/^import[^;]*@\/platform\/supabase\/client/m);
    expect(sheet).toContain('import("@/platform/supabase/client")');
  });

  it("the per-row Collect links on Students do not prefetch", () => {
    const rows = source("src/vx/screens/admin/students.tsx").split(/\r?\n/).filter((line) => line.includes("/payments?student="));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const line of rows) expect(line).toContain("prefetch={false}");
  });
});

describe("attendance this week at 01:30 IST (admin B8)", () => {
  it("keys the week on the school's day, so Wednesday's register sits under Wednesday", () => {
    // 01:30 IST on Thursday 15 October is still Wednesday in UTC.
    const today = schoolToday(new Date("2026-10-14T20:00:00Z"));
    expect(today).toBe("2026-10-15");
    const bars = weekBars(today, [{ day: "2026-10-13", percent: null }, { day: "2026-10-14", percent: 93 }], 97);
    expect(bars.map((b) => [b.day, b.weekday, b.percent, b.isToday])).toEqual([
      ["2026-10-12", 1, null, false],
      ["2026-10-13", 2, null, false],
      ["2026-10-14", 3, 93, false],
      ["2026-10-15", 4, 97, true],
      ["2026-10-16", 5, null, false],
      ["2026-10-17", 6, null, false],
    ]);
  });
});
