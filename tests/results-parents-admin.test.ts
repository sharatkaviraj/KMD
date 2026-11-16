import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canShowResultsToParents, RESULT_RELEASERS } from "@/vx/screens/exams/domain/finalise";

/*
 * Marks for parents (D-647). The owner (16 Nov 2026): teachers publish their
 * marks; only the admin decides whether parents see them; and parents see
 * only the school's own exams, the ones on the report card, never a class
 * test a teacher takes.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(process.cwd(), path)).isDirectory() ? filesUnder(path) : /\.(ts|tsx|sql)$/.test(name) ? [path] : [];
  });
}

describe("who shows marks to parents", () => {
  it("is the admin alone", () => {
    expect(RESULT_RELEASERS).toEqual(["admin"]);
    expect(canShowResultsToParents({ role: "admin" })).toBe(true);
    for (const role of ["exam_coordinator", "academic_coordinator", "teacher", "office", "view_only"] as const) {
      expect(canShowResultsToParents({ role }), role).toBe(false);
    }
    expect(canShowResultsToParents(null)).toBe(false);
  });

  it("is checked before results are released or parents are told", () => {
    const actions = read("src/app/(app)/exam-office/results/actions.ts");
    const release = actions.slice(actions.indexOf("export async function publishResultsAction"), actions.indexOf("export async function tellParentsAction"));
    expect(release).toMatch(/canShowResultsToParents\(staff\)[\s\S]*from\("exam_plans"\)\.upsert/);
    const tell = actions.slice(actions.indexOf("export async function tellParentsAction"));
    expect(tell).toMatch(/canShowResultsToParents\(staff\)[\s\S]*sendResultsOutNotices/);
  });

  it("shows the exam office a note instead of the release buttons", () => {
    const board = read("src/vx/screens/exams/results-board.tsx");
    expect(board).toMatch(/view === "publish" && !exam\.publishedAt && props\.canShowParents/);
    expect(board).toMatch(/props\.notice && props\.canShowParents \? <TellParents/);
    expect(board).toMatch(/function AdminShowsParents\(/);
    expect(read("src/app/(app)/exam-office/results/page.tsx")).toMatch(/canShowParents: canShowResultsToParents\(staff\)/);
  });
});

describe("what parents see", () => {
  it("never a class test: nothing that reaches a parent reads one", () => {
    const parentFacing = [
      ...filesUnder("src/modules/whatsapp"),
      "src/modules/assessments/domain/report-card.ts",
      "src/vx/screens/exams/report-card-pdf.tsx",
      ...filesUnder("supabase/migrations").filter((path) => /parent_helper|report_card/.test(path)),
    ];
    expect(parentFacing.length).toBeGreaterThan(10);
    for (const path of parentFacing) {
      const source = read(path);
      expect(source, path).not.toMatch(/class_test|classTest|class-tests/);
    }
  });

  it("only the school's released exams, with every class locked, in Veer Patta AI's read", () => {
    const helper = read("supabase/migrations/20261114070634_parent_helper_report_cards.sql");
    const results = helper.slice(helper.indexOf("'results', coalesce(("), helper.indexOf("'released_codes'"));
    expect(results).toMatch(/from vppsone\.assessments a/);
    expect(results).toMatch(/join vppsone\.exam_class_locks l/);
    expect(results).toMatch(/p\.results_published_at is not null/);
  });
});
