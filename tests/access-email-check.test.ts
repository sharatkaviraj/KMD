import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { accessEmailCheck, accessEmailVerdict, emailHash } from "../scripts/migrate/lib/access-email.mjs";
import { applyAuthImport, planAuthImport } from "../scripts/migrate/lib/auth-import.mjs";

/**
 * Plan Q6, answered by the owner on 31 Oct: the fees users with no One account
 * sign in by password reset / sign-in link at cutover, and every existing One
 * account keeps its login and password. Addresses here are test values
 * (rule 6).
 */

type Call = { sql: string; values: unknown[] };

function fakeTx() {
  const calls: Call[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return { count: 1 };
    },
    { json: (value: unknown) => value },
  );
  return { tx, calls };
}

describe("the loader never writes a remapped One account's auth row or any password (Q6)", () => {
  const source = [
    // Same email as a One account: remapped onto it.
    { id: "fees-a", email: "Office@QA.vpps.local", encrypted_password: "$2a$fake-hash", identities: [{ id: "i-a", provider: "email" }] },
    // No One account: imported with its fees id.
    { id: "fees-b", email: "new@qa.vpps.local", encrypted_password: "$2a$fake-hash", identities: [{ id: "i-b", provider: "email" }] },
    // Imported by an earlier load: updated in place.
    { id: "fees-c", email: "kept@qa.vpps.local", encrypted_password: "$2a$fake-hash", identities: [] },
  ];
  const target = [
    { id: "one-a", email: "office@qa.vpps.local" },
    { id: "fees-c", email: "kept@qa.vpps.local" },
  ];

  it("plans the remap, and only the two others are written", async () => {
    const plan = planAuthImport(source, target);
    expect(plan.remap).toEqual([{ sourceId: "fees-a", targetId: "one-a" }]);
    const { tx, calls } = fakeTx();
    await applyAuthImport(tx, source, plan);
    const touched = calls.flatMap((call) => call.values).filter((value) => typeof value === "string");
    expect(touched).not.toContain("fees-a");
    expect(touched).not.toContain("one-a");
    expect(touched).not.toContain("i-a");
    expect(calls.filter((call) => /insert into auth\.users/.test(call.sql))).toHaveLength(2);
  });

  it("never copies a password hash: a new user gets an empty one, an existing one keeps its own", async () => {
    const plan = planAuthImport(source, target);
    const { tx, calls } = fakeTx();
    await applyAuthImport(tx, source, plan);
    for (const call of calls) {
      expect(call.values).not.toContain("$2a$fake-hash");
      const [, onConflict = ""] = call.sql.split(/on conflict/i);
      expect(onConflict).not.toMatch(/encrypted_password/);
    }
    const authInsert = calls.find((call) => /insert into auth\.users/.test(call.sql));
    expect(authInsert?.sql).toMatch(/encrypted_password\)\s*values/);
    expect(authInsert?.sql).toMatch(/, ''\)\s*on conflict/);
  });

  it("the source says so", () => {
    const text = readFileSync(join(process.cwd(), "scripts/migrate/lib/auth-import.mjs"), "utf8");
    expect(text).toContain("The password hash is never copied and never overwritten");
  });
});

describe("access-email-check (Q6): role and yes/no only, compared as hashes", () => {
  const sourceFeeUsers = [
    { id: "fees-a", role: "admin" },
    { id: "fees-b", role: "accountant" },
    { id: "fees-c", role: "accountant" },
    { id: "fees-d", role: "view_only" },
  ];
  const sourceAuthUsers = [
    { id: "fees-a", email: "owner@qa.vpps.local" },
    { id: "fees-b", email: "Desk@QA.vpps.local " },
    { id: "fees-c", email: "changed@qa.vpps.local" },
    { id: "fees-d", email: "late@qa.vpps.local" },
    // Not a fees staff member (no public.users row): never asked about.
    { id: "parent-x", email: "x@qa.vpps.local" },
  ];
  const targetAuthUsers = [
    { id: "one-owner", email: "owner@qa.vpps.local" },
    { id: "fees-b", email: "desk@qa.vpps.local" },
    { id: "fees-c", email: "edited-in-one@qa.vpps.local" },
  ];

  it("lists only the fees users with no One account, by role", () => {
    const result = accessEmailCheck({ sourceAuthUsers, sourceFeeUsers, targetAuthUsers });
    expect(result.remapped).toBe(1);
    expect(result.clashes).toBe(0);
    expect(result.rows).toEqual([
      { role: "accountant", match: "no" },
      { role: "accountant", match: "yes" },
      { role: "view_only", match: "not loaded" },
    ]);
  });

  it("prints nothing that names a person", () => {
    const result = accessEmailCheck({ sourceAuthUsers, sourceFeeUsers, targetAuthUsers });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/@|fees-|one-/);
  });

  it("hashes the lowercase, trimmed address", () => {
    expect(emailHash(" A@B.local ")).toBe(emailHash("a@b.local"));
    expect(emailHash("a@b.local")).toMatch(/^[0-9a-f]{64}$/);
    expect(emailHash("")).toBeNull();
    expect(emailHash(null)).toBeNull();
  });

  it("a missing address on either side is not a match", () => {
    const result = accessEmailCheck({
      sourceAuthUsers: [{ id: "fees-z", email: null }],
      sourceFeeUsers: [{ id: "fees-z", role: "admin" }],
      targetAuthUsers: [{ id: "fees-z", email: null }],
    });
    expect(result.rows).toEqual([{ role: "admin", match: "no" }]);
  });

  it("'ok' only when every row is yes: a 'not loaded' row is NOT VERIFIED and refuses by default", () => {
    // Today's state: the first real load has not run, every row not loaded.
    const before = { rows: [{ role: "admin", match: "not loaded" }, { role: "accountant", match: "not loaded" }], remapped: 6, clashes: 0 };
    expect(accessEmailVerdict(before)).toEqual({ verdict: expect.stringMatching(/^NOT VERIFIED/), exitCode: 2 });
    // A load that skipped one user is not a green light either.
    const skipped = { rows: [{ role: "admin", match: "yes" }, { role: "view_only", match: "not loaded" }], remapped: 0, clashes: 0 };
    expect(accessEmailVerdict(skipped).exitCode).toBe(2);
    expect(accessEmailVerdict(skipped).verdict).not.toBe("ok");
    // --before-load: exit 0, and it says it clears nothing.
    const look = accessEmailVerdict(before, { beforeLoad: true });
    expect(look.exitCode).toBe(0);
    expect(look.verdict).toMatch(/informational only/);
    expect(look.verdict).toMatch(/clears no access email/);
    // --before-load never lifts a "no" or a clash.
    expect(accessEmailVerdict({ rows: [{ role: "admin", match: "no" }], remapped: 0, clashes: 0 }, { beforeLoad: true }).exitCode).toBe(2);
    expect(accessEmailVerdict({ rows: [], remapped: 0, clashes: 1 }, { beforeLoad: true }).exitCode).toBe(2);
    expect(accessEmailVerdict({ rows: [{ role: "admin", match: "yes" }, { role: "accountant", match: "yes" }], remapped: 6, clashes: 0 })).toEqual({ verdict: "ok", exitCode: 0 });
  });

  it("the script reads only, and is documented", () => {
    const script = readFileSync(join(process.cwd(), "scripts/migrate/access-email-check.mjs"), "utf8");
    expect(script).toContain('sql.begin("read only"');
    expect(script).toContain("openFeesReadOnly");
    expect(script).toContain("accessEmailVerdict(result");
    expect(script).not.toMatch(/sendAisensy|resetPasswordForEmail|generateLink|inviteUserByEmail/);
    const doc = readFileSync(join(process.cwd(), "docs/cutover/MIGRATION-TOOLS.md"), "utf8");
    expect(doc).toContain("access-email-check.mjs");
  });
});
