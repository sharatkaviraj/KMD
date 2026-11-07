import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Fees dashboard prepared missing dues in `after()` from the page render.
 * In One every fee read asks the cookie who is reading (the roster projection
 * fetch), and Next refuses `cookies()` inside `after()` during a render, so it
 * never ran: live logs said "Unable to load school defaults" on each visit
 * (7 Nov 2026). It is a server action now, started by the page's client.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Fees dashboard dues preparation", () => {
  it("is not scheduled with after() from the render", () => {
    const queries = read("src/modules/dashboard/data/queries.ts");
    expect(queries).not.toContain('import { after } from "next/server"');
    expect(queries).not.toContain("scheduleDashboardAutoPrepare");
    expect(read("src/app/(app)/fees/dashboard/page.tsx")).not.toContain("scheduleDashboardAutoPrepare");
  });

  it("runs as a guarded server action with the session it was shown", () => {
    const action = read("src/app/(app)/fees/dashboard/auto-prepare-actions.ts");
    expect(action.trimStart().startsWith('"use server"')).toBe(true);
    expect(action).toContain('requireStaffPermission("fees:write")');
    expect(action).toContain("assertSessionWritable(null, sessionLabel)");
    expect(action).toContain("filterVisibleStudentIds(null, requested)");
    expect(action).toMatch(/prepareDuesForStudentsAutomatically\(\{[^}]*sessionLabel/);
  });

  it("only promises preparation where the write can land", () => {
    const page = read("src/app/(app)/fees/dashboard/page.tsx");
    expect(page).toContain("isTestAcademicSessionLabel(sessionLabel) || (await currentFeeWritesMode()) === \"open\"");
    expect(page).toContain("<AutoPrepareDues sessionLabel={sessionLabel} studentIds={autoPrepareIds} />");
  });
});
