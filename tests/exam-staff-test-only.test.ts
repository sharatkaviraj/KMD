import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Exam-office replay E09, 6 Nov 2026: a TEST exam's duty sharing and setter
// picker offered real teachers, and "Share duties" wrote them onto it.
describe("exam staff for a test account are test accounts", () => {
  const data = readFileSync("src/vx/screens/exams/data.ts", "utf8");
  const plan = readFileSync("src/app/(app)/exam-office/plan/actions.ts", "utf8");

  it("staffList narrows to test accounts for a test viewer", () => {
    const body = data.slice(data.indexOf("export async function staffList"));
    expect(body).toMatch(/viewer\?\.isTestAccount\) query = query\.eq\("is_test_account", true\)/);
  });

  it("a test account cannot set a real teacher as a paper's setter", () => {
    const body = plan.slice(plan.indexOf("export async function setPaperSetterAction"));
    expect(body.slice(0, 900)).toMatch(/staff\.isTestAccount && !\(await isTestProfile\(input\.staffId\)\)/);
  });
});
