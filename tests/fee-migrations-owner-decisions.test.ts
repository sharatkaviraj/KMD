import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isOneOwnedAppSetting } from "../scripts/migrate/lib/import-rules.mjs";
import { ONLINE_SWITCH_KEYS } from "@/modules/payments/domain/online/switches";

/**
 * The owner's decisions of 31 Oct (D-350 approved, D-355, Q6, Q20, the fees
 * Pay-now tail) and the schema-parity fix that came with them, as files. What
 * the database does is proven on wtgx in scripts/verify-staff-login-fee-role.sql
 * (rolled back) and by has_table_privilege after applying; this pins the parts
 * a later edit could quietly lose.
 */

const root = path.resolve(__dirname, "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("school_notice_sends: the service role gets what the ported sender uses (31 Oct parity diff)", () => {
  const sql = read("supabase", "fee-migrations", "20261031090000_school_notice_sends_service_grants.sql");

  it("says why it differs from the fees app", () => {
    expect(sql.startsWith("-- ============================================================================\n-- VPPS One fee-migration, One-only")).toBe(true);
    expect(sql).toContain("Why it differs from the fees app");
  });

  it("grants select, insert, update to service_role and nothing to anon or authenticated", () => {
    const grants = sql.split("\n").filter((line) => /^\s*grant\b/i.test(line));
    expect(grants).toEqual(["grant select, insert, update on public.school_notice_sends to service_role;"]);
    expect(sql).not.toMatch(/^\s*grant[^\n]*\bto (anon|authenticated|public)\b/im);
  });

  it("matches what the sender does with the table: no delete, and the service-role client only", () => {
    const sender = read("src", "modules", "whatsapp", "data", "school-notice-sender.ts");
    const uses = [...sender.matchAll(/\.from\("school_notice_sends"\)\s*\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(uses)).toEqual(new Set(["select", "insert", "update"]));
    for (const file of ["page.tsx", "actions.ts"]) {
      const source = read("src", "app", "(app)", "fees", "reminders", "notices", file);
      expect(source).toContain('from "@/modules/fees/platform/supabase/admin"');
    }
  });
});

describe("D-355: no trigger on auth.users; One's /staff makes the profile and the fee row follows it", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".sql") ? [path.join(dir, e.name)] : []));

  it("no migration creates a trigger on auth.users", () => {
    for (const file of [...walk(path.join(root, "supabase", "migrations")), ...walk(path.join(root, "supabase", "fee-migrations"))]) {
      const sql = readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
      expect(sql, file).not.toMatch(/create\s+(or\s+replace\s+)?trigger[\s\S]{0,200}?\bon\s+auth\.users\b/i);
      expect(sql, file).not.toMatch(/sync_staff_profile_from_auth_users/);
    }
  });

  it("the /staff login is created bare and linked to the profile, which derives the fee row", () => {
    const actions = read("src", "app", "(app)", "staff", "vx-actions.ts");
    const create = actions.indexOf("admin.auth.admin.createUser(");
    const link = actions.indexOf('.update({ user_id: created.user.id })');
    expect(create).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(create);
    expect(actions).not.toMatch(/from\("users"\)/);
    const derive = read("supabase", "fee-migrations", "20261031000100_fee_user_from_staff_profile.sql");
    expect(derive).toContain("after insert or update of role, is_active, user_id, display_name on vppsone.staff_profiles");
  });

  it("the proof covers the /staff path, sign-ups and admins, and changes nothing", () => {
    const proof = read("scripts", "verify-staff-login-fee-role.sql");
    expect(proof.trimStart().startsWith("--")).toBe(true);
    expect(proof).toMatch(/^begin;$/m);
    expect(proof.trimEnd().endsWith("rollback;")).toBe(true);
    expect(proof).not.toMatch(/^\s*commit\b/im);
    for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) expect(proof, id).toContain(`'${id}', `);
    expect(proof).toContain("@qa.vpps.local");
    // Role and activation changes go through the function /staff calls, never
    // a raw update of staff_profiles.role / is_active.
    expect(proof.match(/vppsone\.change_staff_authority\(v_actor, v_profile, /g)?.length).toBe(4);
    expect(proof).not.toMatch(/update vppsone\.staff_profiles set (role|is_active)\b/);
  });

  it("the fees app's staff screen no longer writes public.users: it sends an admin to /staff", () => {
    const page = read("src", "app", "(app)", "fees", "staff", "page.tsx");
    expect(page).toContain('requireStaffPermission("staff:manage"');
    expect(page).toContain('redirect("/staff")');
    const actions = read("src", "app", "(app)", "fees", "staff", "actions.ts");
    expect(actions).not.toMatch(/createStaffAccount\(|updateStaffAccount\(|resetStaffAccountPassword\(/);
    expect(actions).toContain("Staff accounts are managed on Staff & roles (/staff)");
  });

  it("the ported writers of public.users and auth.users stay dead code: nothing in src calls them", () => {
    // staff-fees/data/queries.ts keeps the fees app's createStaffAccount,
    // updateStaffAccount and resetStaffAccountPassword so the ported file
    // stays diffable against its source; an import of any of them would bring
    // a second writer of logins and fee roles back (D-350, D-355).
    const writers = /\b(createStaffAccount|updateStaffAccount|resetStaffAccountPassword)\b/;
    const home = path.join("src", "modules", "staff-fees", "data", "queries.ts");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && rel !== home && writers.test(read(rel))) offenders.push(rel);
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });

  it("the fee navigation sends Staff & roles to /staff, not the redirecting /fees/staff", () => {
    const nav = read("src", "modules", "fees", "config", "navigation.ts");
    expect(nav).not.toMatch(/href: "\/fees\/staff"/);
    const settings = read("src", "app", "(app)", "fees", "settings", "page.tsx");
    expect(settings).not.toContain("admin staff creation");
  });
});

describe("the eight online switches (OLD-PAY-NOW.md)", () => {
  const all = [...ONLINE_SWITCH_KEYS, "online_payment_staff_whatsapp_enabled"];

  it("One has all eight of the fees app's switches, and the mirror never overwrites any", () => {
    expect(new Set(all)).toEqual(
      new Set([
        "online_payment_links_enabled",
        "online_payment_auto_posting_enabled",
        "online_payment_receipts_enabled",
        "online_payment_checkout_enabled",
        "online_payment_checkout_all_sessions",
        "online_payment_checkout_modal_enabled",
        "online_payment_waive_late_fees",
        "online_payment_staff_whatsapp_enabled",
      ]),
    );
    for (const key of all) expect(isOneOwnedAppSetting(key), key).toBe(true);
    const off = read("supabase", "fee-migrations", "20261031120200_online_switches_default_off.sql");
    for (const key of all) expect(off).toContain(`('${key}')`);
  });

  it("the transition page names the one switch the owner turns off, and where", () => {
    const doc = read("docs", "cutover", "OLD-PAY-NOW.md");
    expect(doc).toContain("online_payment_links_enabled");
    expect(doc).toContain("Payments → Online payments → Switches");
    expect(doc).toContain("online_payment_audit");
    expect(doc).toContain("vppsone.tail_receipts_review");
    for (const key of all) expect(doc).toContain(key);
  });
});
