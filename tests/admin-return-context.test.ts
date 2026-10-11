import assert from "node:assert/strict";
import { it } from "vitest";
import { studentProfileHref, studentReturnHref } from "../src/vx/screens/admin/students-logic";

it("keeps safe directory context through profile tabs and rejects outside destinations", () => {
const list = "/students?q=QA&class=qa-class&view=fees&seg=pending&page=2";
assert.equal(studentReturnHref(list), list);
for (const unsafe of [undefined, "", "https://example.invalid/students", "//example.invalid/students", "/payments", "/students/../students", "/students\\other", "/students/123"]) {
  assert.equal(studentReturnHref(unsafe), "/students");
}
assert.equal(studentReturnHref(`${list}#top`), list);
assert.equal(studentProfileHref("qa"), "/students/qa");
assert.equal(studentProfileHref("qa", undefined, "notes"), "/students/qa?tab=notes");
const href = studentProfileHref("qa", list, "fees");
const url = new URL(href, "https://example.invalid");
assert.equal(url.pathname, "/students/qa");
assert.equal(url.searchParams.get("tab"), "fees");
assert.equal(url.searchParams.get("returnTo"), list);
assert.equal(studentProfileHref("qa", "//example.invalid/students"), "/students/qa");
console.log("Admin return context: safe directory, filters, tabs and direct links passed");
});
