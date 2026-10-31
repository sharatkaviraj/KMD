import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every column the app reads from `vppsone.staff_profiles` through the cookie
 * client is one `authenticated` may SELECT.
 *
 * 20261004041954 replaced the table-wide grant with a column list. A column
 * added after it (`is_test_account`, 20261030112133) is unreadable until it is
 * granted, and PostgREST then refuses the WHOLE select: every signed-in page
 * read "permission denied for table staff_profiles" and sent its user to
 * /login?reason=no-profile (found by tests/e2e/test-session.spec.ts, Phase C).
 * This test reads the migrations so the next added column fails here first.
 */

const MIGRATIONS = "supabase/migrations";

function grantedColumns(): Set<string> {
  const granted = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "").toLowerCase();
    if (/revoke\s+select\s+on\s+vppsone\.staff_profiles\s+from\s+authenticated/.test(sql)) granted.clear();
    for (const match of sql.matchAll(/grant\s+select\s*\(([^)]*)\)\s*on\s+vppsone\.staff_profiles\s+to\s+authenticated/g)) {
      for (const column of match[1].split(",")) granted.add(column.trim());
    }
  }
  return granted;
}

function selectedColumns(): string[] {
  const source = readFileSync("src/platform/auth/current-staff.ts", "utf8");
  const block = source.match(/const STAFF_PROFILE_COLUMNS =([\s\S]*?);/);
  if (!block) throw new Error("STAFF_PROFILE_COLUMNS not found");
  return [...block[1].matchAll(/"([^"]*)"/g)]
    .map((match) => match[1])
    .join("")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

describe("staff_profiles column grants", () => {
  it("cover every column current-staff.ts reads as the signed-in person", () => {
    const granted = grantedColumns();
    const selected = selectedColumns();
    expect(selected).toContain("is_test_account");
    expect(selected.filter((column) => !granted.has(column))).toEqual([]);
  });

  it("still keep the phone numbers unreadable", () => {
    const granted = grantedColumns();
    expect(granted.has("phone")).toBe(false);
    expect(granted.has("whatsapp_phone")).toBe(false);
  });
});
