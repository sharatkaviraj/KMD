import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { db, signIn } from "./support/harness";

const runTag = "phoneops-20261011-admin-501680c9";
const fields = ["e9e1f078-d9f1-43de-a6c2-c5279f402430", "e3f433b4-ad2c-4910-a713-b4c7a1d89d52", "466b5a01-bd83-464a-ada3-1288f0ae84a2"];
const requests = ["6f5353e0-d58a-44f0-b7f5-5a9755c2ea0f", "a96baabb-8283-4cf1-a0d5-484cbed21fcd"];
async function snapshot() {
  const records = await db().from("student_records").select("field_id,value,source").in("field_id", fields).order("field_id");
  const submissions = await db().from("collection_submissions").select("id,field_id,status,value,request_id").in("request_id", requests).order("id");
  const history = await db().from("student_record_history").select("id,field_id,outcome,old_value,new_value,old_source").in("field_id", fields).order("id");
  for (const result of [records, submissions, history]) if (result.error) throw new Error(result.error.message);
  return { records: records.data!, submissions: submissions.data!, history: history.data! };
}

test("retained tagged admin decisions and reload UI are unchanged on phone (read only)", async ({ browser }) => {
  test.setTimeout(300_000);
  const before = await snapshot();
  expect(before.records.find(row => row.field_id === fields[0])).toMatchObject({ value: `${runTag}-new-a`, source: "teacher" });
  expect(before.records.find(row => row.field_id === fields[1])).toMatchObject({ value: `${runTag}-old-b`, source: "office" });
  expect(before.records.find(row => row.field_id === fields[2])).toMatchObject({ value: `${runTag}-new-c`, source: "teacher" });
  expect(before.submissions.find(row => row.value === `${runTag}-new-a`)?.status).toBe("accepted");
  expect(before.submissions.find(row => row.value === `${runTag}-new-b`)?.status).toBe("pending");
  expect(before.submissions.find(row => row.value === `${runTag}-new-c`)?.status).toBe("accepted");
  expect(before.submissions.find(row => row.value === `${runTag}-older-c`)?.status).toBe("rejected");
  expect(before.history.filter(row => row.field_id === fields[0] && row.outcome === "written")).toHaveLength(1);
  expect(before.history.filter(row => row.field_id === fields[1])).toHaveLength(0);
  expect(before.history.filter(row => row.field_id === fields[2] && row.outcome === "written")).toHaveLength(1);
  expect(before.history.find(row => row.field_id === fields[2])).toMatchObject({ old_value: `${runTag}-office-correction`, new_value: `${runTag}-new-c`, old_source: "office" });
  const context = await browser.newContext({ baseURL: "http://localhost:3100", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    // This recovery test must never submit a product action.
    await context.route("**/collection/review", async route => {
      if (route.request().method() === "POST") await route.abort("blockedbyclient");
      else await route.continue();
    });
    const page = await context.newPage();
    try { await signIn(page, "admin", "/collection/review"); }
    catch { throw new Error("Existing QA admin could not authenticate local DEV read-only review"); }
    await page.reload();
    const rows = page.locator("li").filter({ has: page.locator("form") });
    await expect(rows.filter({ hasText: `${runTag}-new-b` })).toHaveCount(1);
    for (const value of ["new-a", "new-c", "older-c"]) await expect(rows.filter({ hasText: `${runTag}-${value}` })).toHaveCount(0);
    await expect(rows.filter({ hasText: `${runTag}-new-b` }).locator('[data-decide="accept"]')).toHaveCount(1);
    const after = await snapshot();
    expect(after).toEqual(before);
    const result = { at: new Date().toISOString(), runTag, target: "wtgxcptmucjerhufzjcf", device: { viewport: "390x844", hasTouch: true, isMobile: true, physical: false }, action: "read-only-recovery", before, after, ui: { pendingB: 1, acceptedA: 0, acceptedC: 0, rejectedOlderC: 0 }, retained: true };
    writeFileSync("../evidence/admin-readback.json", JSON.stringify(result, null, 2));
    const ledger = JSON.parse(readFileSync("../evidence/admin-ledger.json", "utf8"));
    expect(ledger.runTag).toBe(runTag);
    ledger.entries.push(result);
    writeFileSync("../evidence/admin-ledger.json", JSON.stringify(ledger, null, 2));
  } finally { await context.close().catch(() => {}); }
});
