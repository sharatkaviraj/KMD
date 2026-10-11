import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { db, signIn } from "./support/harness";

test("read-only admin fixture baseline and settled DEV review routes", async ({ browser }) => {
  const ledgerPath = path.resolve("../evidence/admin-ledger-phoneops-20261011-admin-followup-9862c9ee.json");
  const fixture = JSON.parse(readFileSync(ledgerPath, "utf8"));
  expect(fixture.target).toBe("wtgxcptmucjerhufzjcf");
  const fields: string[] = fixture.entries.filter((e: { action: string; table: string }) => e.action === "fixture-create" && e.table === "collection_fields").map((e: { key: string }) => e.key);
  const requests: string[] = fixture.entries.filter((e: { action: string; table: string }) => e.action === "fixture-create" && e.table === "collection_requests").map((e: { key: string }) => e.key);
  expect(fields).toHaveLength(3); expect(requests).toHaveLength(2);
  const read = async () => {
    const [submissions, records, history] = await Promise.all([
      db().from("collection_submissions").select("id,request_id,field_id,status,value,previous_value").in("request_id", requests),
      db().from("student_records").select("field_id,value,source").eq("student_id", fixture.studentId).in("field_id", fields),
      db().from("student_record_history").select("id,field_id,outcome").eq("student_id", fixture.studentId).in("field_id", fields),
    ]);
    for (const result of [submissions, records, history]) if (result.error) throw new Error(result.error.message);
    return { submissions: submissions.data, records: records.data, history: history.data };
  };
  const before = await read();
  expect(before.submissions).toHaveLength(4);
  expect(before.submissions!.every(row => row.status === "pending")).toBe(true);
  expect(before.records).toHaveLength(3); expect(before.history).toHaveLength(0);
  const routes: Record<string, unknown>[] = [];
  const save = (after?: typeof before) => writeFileSync(path.resolve("../evidence/admin-followup-readonly-baseline-9862c9ee.json"), JSON.stringify({ tag: fixture.runTag, target: fixture.target, routes, before, after: after ?? null, mutationCount: 0 }, null, 2));
  save();
  for (const actor of ["admin", "teacher"]) {
    const context = await browser.newContext({ baseURL: "http://localhost:3100", viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    try {
      const page = await context.newPage(); let authStatus = 0;
      page.on("response", response => { if (new URL(response.url()).pathname === "/auth/confirm") authStatus = response.status(); });
      try { await signIn(page, actor, "/collection/review"); } catch { throw new Error(`Existing QA ${actor} sign-in failed; token URL withheld`); }
      routes.push({ actor, authStatus, phase: "auth-returned", path: new URL(page.url()).pathname }); save();
      expect(authStatus).toBeGreaterThanOrEqual(200); expect(authStatus).toBeLessThan(400);
      await page.waitForURL(url => url.pathname === "/collection/review" || (actor === "teacher" && url.pathname === "/access-denied" && url.searchParams.get("permission") === "collection:view"), { timeout: 90_000 });
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 90_000 });
      const bulkCount = await page.locator("[data-bulk-decide]").count();
      if (actor === "admin") expect(bulkCount).toBe(1); else expect(bulkCount).toBe(0);
      routes.push({ actor, authStatus, phase: "settled", path: new URL(page.url()).pathname, headings: await page.getByRole("heading", { level: 1 }).count(), bulkCount, width: 360, hasTouch: true }); save();
    } finally { await context.close(); }
  }
  const after = await read(); expect(after).toEqual(before);
  save(after);
});
