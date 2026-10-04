import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  readsEveryClass,
  rolePermissions,
  SCHOOL_WIDE_ROLES,
  staffRoles,
} from "@/platform/auth/permissions";

/**
 * The database and the app have to ask the same questions (P1).
 *
 * `vppsone.role_permissions` is the permission map as rows, and
 * `vppsone.reads_every_class()` names the school-wide roles in SQL. If either
 * drifts from `permissions.ts`, a screen the app allows comes back empty — or
 * worse, the database allows a read the app never meant to. These tests read
 * the migrations as text, because the migrations are what reaches the database.
 */

const migrations = path.join(process.cwd(), "supabase", "migrations");
const authority = readdirSync(migrations).find((name) =>
  name.endsWith("_staff_authority_and_scoped_reads.sql"),
);
const sql = readFileSync(path.join(migrations, authority!), "utf8");

describe("vppsone.role_permissions", () => {
  it("is seeded with exactly the TypeScript map", () => {
    const seeded = [...sql.matchAll(/\('([a-z_]+)', '([a-z_]+:[a-z_]+)'\)/g)].map(
      ([, role, permission]) => `${role} ${permission}`,
    );
    const expected = staffRoles.flatMap((role) =>
      rolePermissions[role].map((permission) => `${role} ${permission}`),
    );
    expect(new Set(seeded)).toEqual(new Set(expected));
    expect(seeded).toHaveLength(expected.length);
  });
});

describe("school-wide roles", () => {
  it("are the same list in SQL and TypeScript", () => {
    const body = /function vppsone\.reads_every_class\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1];
    const named = [...(body ?? "").matchAll(/'([a-z_]+)'/g)].map(([, role]) => role);
    expect(new Set(named)).toEqual(new Set(SCHOOL_WIDE_ROLES));
  });

  it("leave a teacher to her own classes", () => {
    expect(readsEveryClass({ role: "teacher" })).toBe(false);
    expect(readsEveryClass({ role: "office" })).toBe(true);
    expect(readsEveryClass({ role: "view_only" })).toBe(false);
    expect(readsEveryClass(null)).toBe(false);
  });
});

describe("the migration", () => {
  it("drops every using (true) read policy and creates no new one", () => {
    expect(sql).toMatch(/where schemaname = 'vppsone' and cmd = 'SELECT' and qual = 'true'/);
    // Comments describe the old policy; the statements must not recreate it.
    const statements = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(statements).not.toMatch(/using \(true\)/);
  });

  it("gives the authority command to the service role only", () => {
    expect(sql).toMatch(
      /grant execute on function vppsone\.change_staff_authority\([^)]*\) to service_role;/,
    );
    expect(sql).not.toMatch(/change_staff_authority\([^)]*\) to authenticated/);
  });

  it("scopes a teacher's classes over the whole effective interval", () => {
    expect(sql).toMatch(/ct\.effective_from <= vppsone\.school_today\(\)/);
    expect(sql).toMatch(/ct\.effective_to >= vppsone\.school_today\(\)/);
  });

  it("hides phones, absence reasons and link tokens from direct reads", () => {
    const columns = readdirSync(migrations).find((name) =>
      name.endsWith("_hide_phone_reason_and_token_columns.sql"),
    );
    const hidden = readFileSync(path.join(migrations, columns!), "utf8");
    const granted = (table: string) =>
      new RegExp(`grant select \\(([^)]*)\\)\\s*on vppsone\\.${table} to authenticated`).exec(
        hidden,
      )?.[1] ?? "";

    expect(granted("staff_profiles")).not.toMatch(/\bphone\b|whatsapp_phone/);
    expect(granted("staff_profiles")).toMatch(/display_name/);
    expect(granted("teacher_absences")).not.toMatch(/\breason\b/);
    expect(granted("collection_requests")).not.toMatch(/\btoken\b|contact_phone/);
    expect(granted("collection_requests")).toMatch(/assigned_staff_id/);
  });
});
