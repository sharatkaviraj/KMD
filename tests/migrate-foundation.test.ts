import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { diffFingerprints, unwrapFingerprint } from "../scripts/migrate/catalog-diff.mjs";
import { oneDbOptions } from "../scripts/migrate/lib/one-db.mjs";

/**
 * PR-1 foundation: the direct-connection helper refuses every project but
 * One's, the parity diff names what differs, and every fee-schema file One
 * owns says why it differs from the fees app. Synthetic values only.
 */

const repoRoot = path.resolve(__dirname, "..");
const env = (ref: string) => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_DEV_DB_PASSWORD: "synthetic-password",
});

describe("one-db.mjs", () => {
  it("connects to One's main project over the session pooler", () => {
    const options = oneDbOptions(env("wtgxcptmucjerhufzjcf"));
    expect(options.port).toBe(5432);
    expect(options.username).toBe("postgres.wtgxcptmucjerhufzjcf");
    expect(options.ssl).toBe("require");
  });

  it("refuses the fees app's live database by name, and anything else", () => {
    expect(() => oneDbOptions(env("vgqyilgstjvgohrsiwkb"))).toThrow(/fees app's live database/);
    expect(() => oneDbOptions(env("abcdefghijklmnopqrst"))).toThrow(/only wtgxcptmucjerhufzjcf/);
    expect(() => oneDbOptions({ NEXT_PUBLIC_SUPABASE_URL: "https://elsewhere.example/?wtgxcptmucjerhufzjcf" })).toThrow(/Refusing/);
  });

  it("needs the password and never invents one", () => {
    expect(() => oneDbOptions({ NEXT_PUBLIC_SUPABASE_URL: "https://wtgxcptmucjerhufzjcf.supabase.co" })).toThrow(/SUPABASE_DEV_DB_PASSWORD/);
  });
});

describe("catalog-diff.mjs", () => {
  it("unwraps every shape a tool returns", () => {
    const fp = { fn: { a: "1" } };
    expect(unwrapFingerprint(fp)).toEqual(fp);
    expect(unwrapFingerprint({ fingerprint: fp })).toEqual(fp);
    expect(unwrapFingerprint([{ fingerprint: JSON.stringify(fp) }])).toEqual(fp);
  });

  it("names changed, live-only and One-only objects, and nothing that is equal", () => {
    const live = { fn: { same: "1", changed: "2", gone: "3" }, pub: { x: "member" } };
    const one = { fn: { same: "1", changed: "9", added: "4" }, pub: { x: "member" } };
    expect(diffFingerprints(live, one)).toEqual({
      fn: { changed: ["changed"], onlyLeft: ["gone"], onlyRight: ["added"] },
    });
  });
});

describe("supabase/fee-migrations", () => {
  const dir = path.join(repoRoot, "supabase", "fee-migrations");
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(17);
  });

  it.each(files)("%s says why it differs from the fees app", (file) => {
    const head = readFileSync(path.join(dir, file), "utf8").slice(0, 1500);
    expect(head).toMatch(/VPPS One fee-migration/);
    expect(head).toMatch(/differ/i);
  });

  it.each(files)("%s schedules no cron job (it would call the fees app's production)", (file) => {
    const sql = readFileSync(path.join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/schoolfees-two|vercel\.app/i);
  });

  it("guards every money function its header lists", () => {
    const sql = readFileSync(path.join(dir, "20261030230000_fee_writes_guard.sql"), "utf8");
    const header = sql.slice(0, sql.indexOf("create or replace function"));
    const injected = [...sql.matchAll(/\('((?:public|private)\.[a-z_]+)\(/g)].map((m) => m[1]);
    for (const name of new Set(injected)) expect(header).toContain(name);
    expect(new Set(injected).size).toBe(14);
  });

  it("guards direct writes to every money table, and keeps the switch the owner's", () => {
    const sql = readFileSync(path.join(dir, "20261030230200_fee_writes_table_guard.sql"), "utf8");
    const list = /foreach t in array array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? "";
    const tables = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const table of ["payments", "receipts", "receipt_adjustments", "payment_adjustments", "installments", "student_fee_overrides", "student_carry_forward_balances", "student_late_fee_waivers", "refund_requests", "student_repayment_plans"]) {
      expect(tables).toContain(table);
    }
    expect(sql).toMatch(/before update of class_id on public\.students/);
    expect(sql).toMatch(/before update of session_label on public\.classes/);
    expect(sql).toMatch(/before insert or update or delete on public\.app_settings/);
    expect(sql).toMatch(/key = 'fee_writes_enabled'/);
  });

  it("fences a test account's fee writes to TEST students without dropping the D-347 switch", () => {
    const sql = readFileSync(path.join(dir, "20261031000200_test_account_fee_write_fence.sql"), "utf8");
    const guard = /create or replace function vppsone\.fee_money_row_guard\(\)[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    // Both halves, in the one trigger function every money table runs.
    expect(guard).toMatch(/current_is_test_account\(\)/);
    expect(guard).toMatch(/assert_test_account_may_write_student\(old\.student_id\)/);
    expect(guard).toMatch(/assert_test_account_may_write_student\(new\.student_id\)/);
    expect(guard).toMatch(/not vppsone\.fee_writes_open\(\)/);
    expect(guard).toMatch(/assert_fee_writes_allowed\(old\.student_id\)/);
    expect(sql).toMatch(/before insert or update or delete on public\.students/);
    expect(sql).toMatch(/before insert or update or delete on public\.classes/);
    expect(sql).toMatch(/before insert or update or delete on public\.academic_sessions/);
    expect(sql).toMatch(/before insert or update or delete on public\.app_settings/);
  });
});
