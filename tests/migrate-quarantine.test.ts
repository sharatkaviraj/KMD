import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { rolePermissions, staffRoles } from "@/platform/auth/permissions";

import { classRefsWhere, ownerActivityWhere } from "../scripts/migrate/classify-dev-vppsone.mjs";
import { missingMigrations, STEPS } from "../scripts/migrate/convert-to-production.mjs";
import { realDataMarker } from "../scripts/migrate/load-snapshot.mjs";
import { describeTables, unlistedRefColumns } from "../scripts/migrate/lib/vppsone-catalog.mjs";
import {
  checkBackup,
  classesWithoutLivePartner,
  CONVERT_STEPS,
  decideEnrolmentRebuild,
  decideFirstLoadQuarantine,
  decidePromoteSeed,
  decideQuarantineGuard,
  decideReset,
  isTestSessionLabel,
  parseAcceptHeld,
  permissionDiff,
  planClassMap,
  planEnrolments,
  planStaffMap,
  planStudentMap,
  promoteCandidates,
  resetStatements,
  restoreCoverageOf,
  rolePermissionSeed,
  scrubNeeded,
  scrubValue,
  SENSITIVE_FIELD,
  smokeEnforceIsConfined,
  splitCandidates,
  TABLES,
  teacherShortNameMap,
  TEST_SESSION,
  unclassified,
} from "../scripts/migrate/lib/quarantine-rules.mjs";
import { mapParams, planTableOps, planTestClassOps, uuidArray, whereParams } from "../scripts/migrate/lib/quarantine-sql.mjs";
import { devId, uuidV5 } from "../scripts/migrate/lib/uuid5.mjs";
import { groupOf, GROUPS } from "../scripts/migrate/quarantine-in-place.mjs";
import { beforeStateSql, revertStatements } from "../scripts/migrate/repoint-test-class-rows.mjs";
import { offListSql, resetOrder, resetSessionRefusal, RESET_KEEP } from "../scripts/reset-test-session.mjs";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const C = "00000000-0000-4000-8000-0000000000c3";
const D = "00000000-0000-4000-8000-0000000000d4";

/** A catalog entry as describeTables() makes it, for planTableOps. */
function info(table: string, columns: string[], { staff = [] as string[], pk = ["id"], types = {} as Record<string, string> } = {}) {
  return describeTables({
    tables: { [table]: { columns: columns.map((name) => ({ name, type: types[name] ?? "uuid", notNull: false, generated: false })), pk, triggers: [] } },
    fks: staff.map((c) => ({ name: `${table}_${c}_fkey`, child: `vppsone.${table}`, parent: "vppsone.staff_profiles", childCols: [c] })),
  })[table];
}

describe("uuid v5 (lib/uuid5.mjs)", () => {
  it("matches the RFC 4122 example: www.example.com in the DNS namespace", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });
  it("is stable per table and id, and different across tables", () => {
    expect(devId("students", A)).toBe(devId("students", A));
    expect(devId("students", A)).not.toBe(devId("classes", A));
    expect(devId("students", A)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("the bucket list (lib/quarantine-rules.mjs TABLES)", () => {
  it("places every vppsone table a migration creates", () => {
    const created = new Set<string>();
    for (const f of migrationFiles) {
      for (const [, t] of readFileSync(path.join(migrationsDir, f), "utf8").matchAll(/create table (?:if not exists )?vppsone\.([a-z_]+)/g)) created.add(t);
    }
    expect(created.size).toBeGreaterThan(100);
    expect(unclassified(created)).toEqual([]);
  });

  it("puts every table in exactly one known bucket", () => {
    for (const [t, spec] of Object.entries(TABLES)) expect(["A", "K", "B", "R", "C"], t).toContain(spec.bucket);
  });

  it("is the list verify-quarantine.sql checks against", () => {
    const sql = readFileSync(path.join(root, "scripts", "migrate", "verify-quarantine.sql"), "utf8");
    const block = sql.slice(sql.indexOf("-- @buckets-start"), sql.indexOf("-- @buckets-end"));
    const list = (name: string) => {
      const m = new RegExp(`${name}\\(t\\) as \\(select unnest\\(array\\[([\\s\\S]*?)\\]\\)\\)`).exec(block);
      return new Set([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    };
    const of = (...buckets: string[]) => new Set(Object.keys(TABLES).filter((t) => buckets.includes(TABLES[t].bucket)));
    expect(list("a_tables")).toEqual(of("A"));
    expect(list("r_tables")).toEqual(of("R"));
    expect(list("untouched")).toEqual(of("K", "C"));
  });

  it("gives every table a transaction group", () => {
    for (const t of Object.keys(TABLES)) expect(GROUPS.map(([g]) => g)).toContain(groupOf(t));
    expect(groupOf("attendance_marks")).toBe("attendance");
    expect(groupOf("message_sends")).toBe("messages and notices");
  });
});

describe("decideQuarantineGuard", () => {
  const ok = { environment: "production", feeWritesEnabled: "false", hasCutover: false, previousApplied: 0, backup: { ok: true } };
  it("passes only after convert-to-production, with a backup, before any load", () => {
    expect(decideQuarantineGuard(ok).ok).toBe(true);
    expect(decideQuarantineGuard({ ...ok, environment: "dev" }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, environment: null }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, feeWritesEnabled: null }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, feeWritesEnabled: "true" }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, backup: { ok: false, reason: "none" } }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, previousApplied: 1 }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, hasCutover: true }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, unclassifiedTables: ["new_thing"] }).ok).toBe(false);
  });
  it("a rehearsal lifts the marker, fee-writes and backup guards — never the load or cutover ones", () => {
    const dev = { ...ok, environment: "dev", feeWritesEnabled: null, backup: { ok: false } };
    expect(decideQuarantineGuard({ ...dev, rollbackOnly: true }).ok).toBe(true);
    expect(decideQuarantineGuard({ ...dev, previousApplied: 2, rollbackOnly: true }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...dev, hasCutover: true, rollbackOnly: true }).ok).toBe(false);
  });
});

describe("checkBackup (a backup-one run from the last 24 h, on this machine)", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const run = { snapshot_id: "backup-x", finished_at: "2026-11-01T08:00:00Z", summary: { manifest_sha256: "abc", schemas: ["public", "vppsone"] } };
  it("accepts a fresh run whose manifest is here and matches", () => {
    expect(checkBackup([run], () => ({ text: "", sha256: "abc" }), { now })).toMatchObject({ ok: true, runId: "backup-x" });
  });
  it("refuses an old run, a missing manifest, a changed manifest, or one schema only", () => {
    expect(checkBackup([{ ...run, finished_at: "2026-10-30T08:00:00Z" }], () => ({ text: "", sha256: "abc" }), { now }).ok).toBe(false);
    expect(checkBackup([run], () => null, { now }).ok).toBe(false);
    expect(checkBackup([run], () => ({ text: "", sha256: "zzz" }), { now }).ok).toBe(false);
    expect(checkBackup([{ ...run, summary: { ...run.summary, schemas: ["public"] } }], () => ({ text: "", sha256: "abc" }), { now }).ok).toBe(false);
    expect(checkBackup([], () => null, { now }).ok).toBe(false);
  });
});

describe("planClassMap", () => {
  const classes = [
    { id: A, session_label: "2026-27", class_name: "Class 1", section: null, stream_name: null },
    { id: B, session_label: TEST_SESSION, class_name: "class 1", section: null, stream_name: null },
    { id: C, session_label: "2026-27", class_name: "QA Isolated", section: "QA", stream_name: null, sort_order: 9, status: "active" },
  ];
  it("maps a real class to its TEST twin by (name, section, stream)", () => {
    const { map, created } = planClassMap(classes);
    expect(map.get(A)).toBe(B);
    expect(map.has(B)).toBe(false);
    expect(created.map((c) => c.source)).toEqual([C]);
    expect(map.get(C)).toBe(devId("classes", C));
    expect(created[0]).toMatchObject({ session_label: TEST_SESSION, class_name: "QA Isolated", section: "QA" });
  });
  it("creates a TEST class only for a class something points at", () => {
    expect(planClassMap(classes, { referenced: new Set([A]) }).created).toEqual([]);
  });
});

describe("planStudentMap", () => {
  const classSession = new Map([[A, "2026-27"], [B, TEST_SESSION]]);
  const classMap = new Map([[A, B]]);
  const students = new Map([
    [C, { id: C, full_name: "Masked One", class_id: A, status: "active" }],
    [D, { id: D, full_name: "Test Kid", class_id: B, status: "active" }],
  ]);
  it("keeps a student already in a TEST class, shells every other", () => {
    const { map, shells } = planStudentMap([C, D, C], { students, classSession, classMap });
    expect(map.has(D)).toBe(false);
    expect(map.get(C)).toBe(devId("students", C));
    expect(shells).toEqual([{ id: devId("students", C), source: C, admission_no: "TEST-D-0001", full_name: "Masked One", class_id: B, status: "active" }]);
  });
  it("re-uses an existing shell and continues its numbering (idempotent)", () => {
    const existing = new Map([[C, { id: devId("students", C), admission_no: "TEST-D-0007" }]]);
    const other = "00000000-0000-4000-8000-0000000000e5";
    students.set(other, { id: other, full_name: "", class_id: A, status: "left" });
    const { map, shells } = planStudentMap([C, other], { students, classSession, classMap, existing });
    expect(map.get(C)).toBe(devId("students", C));
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ admission_no: "TEST-D-0008", status: "left", full_name: "Test student 0008" });
  });
  it("reports a student who no longer exists (its shell has no class)", () => {
    const gone = "00000000-0000-4000-8000-0000000000f6";
    const r = planStudentMap([gone], { students, classSession, classMap });
    expect(r.missing).toEqual([gone]);
    expect(r.shells[0].class_id).toBeNull();
  });
});

describe("planStaffMap and promoteCandidates (critique0 #16, critique1 A4)", () => {
  const profiles = [
    { id: A, role: "teacher", short_name: "RK", is_active: true, is_teaching: true, is_test_account: true, user_id: "u1", created_at: "1" },
    { id: B, role: "admin", short_name: "OWN", is_active: true, is_teaching: false, is_test_account: false, user_id: "u2", created_at: "2" },
    { id: C, role: "teacher", short_name: "QAT", is_active: true, is_teaching: true, is_test_account: true, user_id: "u3", created_at: "3" },
    { id: D, role: "office", short_name: "OFF", is_active: true, is_teaching: false, is_test_account: false, user_id: null, created_at: "4" },
  ];
  it("a candidate is an active teacher with a timetable short name", () => {
    expect(promoteCandidates(profiles, ["rk", "XX"]).map((p) => p.id)).toEqual([A]);
    expect(promoteCandidates([{ ...profiles[0], short_name: "T-RK" }], ["t-rk"])).toEqual([]);
  });
  it("maps a candidate to its own test twin, which takes over its login", () => {
    const { map, twins } = planStaffMap(profiles, promoteCandidates(profiles, ["RK"]));
    expect(map.get(A)).toBe(devId("staff_profiles", A));
    expect(twins[0]).toMatchObject({ source: A, moveUserFrom: "u1", short_name: "T-RK", role: "teacher" });
  });
  it("maps another real profile to a test account of its role, else a placeholder; leaves test accounts alone", () => {
    const withTestAdmin = [...profiles, { id: "00000000-0000-4000-8000-0000000000aa", role: "admin", short_name: "QAA", is_active: true, is_test_account: true, created_at: "0" }];
    const r = planStaffMap(withTestAdmin, []);
    expect(r.map.get(B)).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(r.map.get(D)).toBe(uuidV5("dev:staff_profiles:placeholder:office"));
    expect(r.placeholders).toEqual([expect.objectContaining({ role: "office", short_name: "TEST-OFFICE" })]);
    expect(r.map.has(C)).toBe(false);
  });
});

describe("planTableOps (lib/quarantine-sql.mjs)", () => {
  const maps = { classMap: new Map([[A, B]]), studentMap: new Map([[C, D]]), staffMap: new Map([[A, B]]) };
  it("a B table: relabel first, then class / student / staff, then scrubs and the terminal state", () => {
    const ops = planTableOps(info("message_sends", ["id", "session_label", "student_id", "staff_profile_id", "to_phone", "to_name", "status"], { staff: ["staff_profile_id"] }), maps);
    expect(ops.map((o) => `${o.kind}:${o.column}`)).toEqual([
      "relabel:session_label",
      "student:student_id",
      "staff:staff_profile_id",
      "scrub:to_phone",
      "scrub:to_name",
      "terminal:status",
    ]);
    expect(ops[0].set).toContain(`'${TEST_SESSION}'`);
    expect(ops.at(-1)!.set).toContain("status = 'cancelled'");
    expect(ops.at(-1)!.set).toContain("sent_at = null");
    for (const op of ops.slice(1)) expect(op.where).toContain("(true)");
  });
  it("an A table: only its TEST rows, never relabelled", () => {
    const ops = planTableOps(info("class_teachers", ["id", "session_label", "class_id", "staff_profile_id", "role", "effective_from", "effective_to"], { staff: ["staff_profile_id"] }), maps);
    expect(ops.map((o) => o.kind)).toEqual(["close-duplicate", "class", "staff"]);
    for (const op of ops) expect(op.where).toContain("vppsone.is_test_session_label(t.session_label)");
  });
  it("K and C tables: nothing", () => {
    expect(planTableOps(info("runtime_flags", ["key", "enabled"], { pk: ["key"] }), maps)).toEqual([]);
    expect(planTableOps(info("smoke_pool", ["email", "staff_profile_id"], { staff: ["staff_profile_id"], pk: ["email"] }), maps)).toEqual([]);
  });
  it("timetable versions leave 'published' when they move to TEST (one published per session)", () => {
    const [relabel] = planTableOps(info("timetable_versions", ["id", "session_label", "status", "archived_at"]), maps);
    expect(relabel.set).toContain("'archived'::vppsone.timetable_status");
  });
  it("planTestClassOps: TEST rows of any table, class only", () => {
    const ops = planTestClassOps(info("notes", ["id", "session_label", "class_id", "student_id"]), maps.classMap);
    expect(ops.map((o) => o.kind)).toEqual(["class"]);
    expect(ops[0].where).toContain("is_test_session_label");
  });
  it("whereParams hands Postgres only the parameters a WHERE uses", () => {
    const [op] = planTestClassOps(info("notes", ["id", "session_label", "class_id"]), maps.classMap);
    expect(whereParams(op)).toHaveLength(1);
    expect(whereParams({ where: "x = $2", params: ["a", "b"] })).toHaveLength(2);
    expect(whereParams({ where: "true", params: ["a"] })).toHaveLength(0);
  });
  it("uuid parameters are literals, and anything else is refused", () => {
    expect(uuidArray([A, B])).toBe(`{${A},${B}}`);
    expect(() => uuidArray(["1); drop table x; --"])).toThrow();
    expect(mapParams(new Map([[A, A], [B, C]]))).toEqual([`{${B}}`, `{${C}}`]);
  });
  it("a rotated token passes every token CHECK and is recognised on a re-run", () => {
    expect(scrubValue("token")).toContain("'q' ||");
    expect(scrubNeeded("token", "token")).toContain("^q[0-9a-f]{31}$");
    expect("q" + "a".repeat(31)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe("smokeEnforceIsConfined (convert-to-production keeps the cron only then)", () => {
  const body = `CREATE OR REPLACE FUNCTION vppsone.smoke_enforce() RETURNS integer AS $function$
  begin
    with live as (select distinct p.auth_user_id from vppsone.smoke_pool p join vppsone.smoke_passes s on s.pool_email = p.email)
    update auth.users u set banned_until = null where u.id in (select auth_user_id from vppsone.smoke_pool) and u.banned_until is distinct from null;
    delete from auth.sessions s where s.user_id in (select auth_user_id from vppsone.smoke_pool) and s.user_id in (select id from auth.users);
  end; $function$`;
  const pool = [{ email: "smoke.t1@qa.vpps.local", staff_profile_id: A, is_test_account: true }];
  it("today's body over a pool of test seats is confined", () => {
    expect(smokeEnforceIsConfined(body, pool).confined).toBe(true);
  });
  it("a body that reaches beyond the pool, a real login or a real profile is not", () => {
    expect(smokeEnforceIsConfined(body.replace("where u.id in (select auth_user_id from vppsone.smoke_pool)", "where true"), pool).confined).toBe(false);
    expect(smokeEnforceIsConfined(body, [{ ...pool[0], email: "teacher@vpps.co.in" }]).confined).toBe(false);
    expect(smokeEnforceIsConfined(body, [{ ...pool[0], is_test_account: false }]).confined).toBe(false);
    expect(smokeEnforceIsConfined(null, pool).confined).toBe(false);
  });
});

describe("convert-to-production", () => {
  it("has a read, apply and revert for every step, in order", () => {
    expect(Object.keys(STEPS)).toEqual(CONVERT_STEPS);
    for (const step of Object.values(STEPS)) {
      expect(typeof step.read).toBe("function");
      expect(typeof step.apply).toBe("function");
      expect(typeof step.revert).toBe("function");
    }
  });
  it("finds a migration file by version or name, a fee-migration by fee_<file>", () => {
    const ledger = [
      { version: "20261011092957", name: "vx_fee_collector_collects" },
      { version: "20261031064046", name: "fee_20261031120200_online_switches_default_off" },
      { version: "20261031064047", name: "fee_20261026120020_whatsapp_scheduled_runs_timer_no_cron" },
    ];
    expect(
      missingMigrations(
        ledger,
        ["20261011092957_vx_fee_collector_role_permissions.sql", "20261101000000_new.sql"],
        ["20261031120200_online_switches_default_off.sql", "20261026120020_whatsapp_scheduled_runs_timer.sql", "20261101000000_x.sql"],
      ),
    ).toEqual({ vppsone: ["20261101000000_new.sql"], fee: ["20261101000000_x.sql"] });
  });
});

describe("promotion (critique0 #20, critique1 A4)", () => {
  it("the role-permission seed is the migrations' map, equal to permissions.ts", () => {
    const seed = rolePermissionSeed(migrationFiles.map((name) => ({ name, text: readFileSync(path.join(migrationsDir, name), "utf8") })));
    const expected = new Set(staffRoles.flatMap((role) => rolePermissions[role].map((p) => `${role} ${p}`)));
    expect(seed).toEqual(expected);
  });
  it("permissionDiff removes what the seed lacks and adds what it has", () => {
    expect(permissionDiff(["admin a:b", "qa x:y"], new Set(["admin a:b", "teacher c:d"]))).toEqual({ remove: ["qa x:y"], add: ["teacher c:d"] });
  });
  it("finds the real class with no live partner", () => {
    const one = [
      { id: A, session_label: "2026-27", class_name: "Class 1", section: null, stream_name: null },
      { id: B, session_label: "2026-27", class_name: "QA Terra", section: "QA", stream_name: null },
    ];
    const live = [{ session_label: "2026-27", class_name: "Class 1", section: null, stream_name: null }];
    expect(classesWithoutLivePartner(one, live, "2026-27").map((c) => c.id)).toEqual([B]);
  });
  it("seed-timetable --production-promote needs every input read and exact", () => {
    const ok = { environment: "production", feeWritesEnabled: "false", promoteRuns: 1, hasCutover: false };
    expect(decidePromoteSeed(ok).ok).toBe(true);
    expect(decidePromoteSeed({ ...ok, environment: null }).ok).toBe(false);
    expect(decidePromoteSeed({ ...ok, environment: "dev" }).ok).toBe(false);
    expect(decidePromoteSeed({ ...ok, feeWritesEnabled: null }).ok).toBe(false);
    expect(decidePromoteSeed({ ...ok, promoteRuns: 0 }).ok).toBe(false);
    expect(decidePromoteSeed({ ...ok, hasCutover: null }).ok).toBe(false);
    expect(decidePromoteSeed({ ...ok, hasCutover: true }).ok).toBe(false);
  });
});

describe("rebuild-enrolments (runbook C8, critique1 B21)", () => {
  const students = [
    { id: "s1", class_id: "c1", status: "active", left_on: null, joined_on: "2026-04-01" },
    { id: "s2", class_id: "c1", status: "left", left_on: "2026-09-01", joined_on: null },
    { id: "s3", class_id: "c2", status: "inactive", left_on: null, joined_on: null },
    { id: "s4", class_id: "c2", status: "active", left_on: null, joined_on: null },
  ];
  it("enrolments = on roll + left; existing rows corrected in place; the rest deleted", () => {
    const existing = [
      { id: "e1", student_id: "s1", class_id: "c1", status: "enrolled", left_on: null },
      { id: "e2", student_id: "s4", class_id: "c1", status: "enrolled", left_on: null },
      { id: "e3", student_id: "s9", class_id: "c1", status: "enrolled", left_on: null },
    ];
    const p = planEnrolments(students, existing);
    expect(p.total).toBe(3);
    expect(p.byStatus).toEqual({ enrolled: 2, left: 1 });
    expect(p.insert).toEqual([{ student_id: "s2", class_id: "c1", status: "left", left_on: "2026-09-01", enrolled_on: null }]);
    expect(p.update).toEqual([{ id: "e2", student_id: "s4", class_id: "c2", status: "enrolled", left_on: null, enrolled_on: null }]);
    expect(p.remove).toEqual(["e3"]);
  });
  it("--apply only on production, fee writes shut, after the real students are in", () => {
    const ok = { environment: "production", feeWritesEnabled: "false", hasCutover: false, firstLoads: 1 };
    expect(decideEnrolmentRebuild(ok).ok).toBe(true);
    expect(decideEnrolmentRebuild({ ...ok, firstLoads: 0 }).ok).toBe(false);
    expect(decideEnrolmentRebuild({ ...ok, firstLoads: 0, hasCutover: true }).ok).toBe(true);
    expect(decideEnrolmentRebuild({ ...ok, environment: "dev" }).ok).toBe(false);
    expect(decideEnrolmentRebuild({ ...ok, feeWritesEnabled: "true" }).ok).toBe(false);
  });
});

describe("restore coverage (backup-one --restore undoes the quarantine)", () => {
  const manifest = [
    { schema: "public", table: "students" },
    { schema: "vppsone", table: "notes" },
    { schema: "vppsone", table: "deployment" },
    { schema: "vppsone", table: "migration_runs" },
  ];
  const keep = { "vppsone.deployment": "marker", "vppsone.migration_runs": "log" };
  it("names the schemas to restore and anything a restore would miss", () => {
    expect(restoreCoverageOf(["public.students", "vppsone.notes", "vppsone.migration_runs"], manifest, keep)).toEqual({ schemas: ["public", "vppsone"], missed: [] });
    expect(restoreCoverageOf(["vppsone.deployment", "auth.users"], manifest, keep).missed).toEqual(["auth.users", "vppsone.deployment"]);
  });
});

describe("reset-test-session (plan §4.5, critique1 B15)", () => {
  it("accepts only TEST-2026-27, named", () => {
    expect(resetSessionRefusal(undefined)).toMatch(/name the session/);
    expect(resetSessionRefusal(true)).toMatch(/name the session/);
    expect(resetSessionRefusal("2026-27")).toMatch(/only TEST-2026-27/);
    expect(resetSessionRefusal("test-2026-27")).toMatch(/only TEST-2026-27/);
    expect(resetSessionRefusal(TEST_SESSION)).toBeNull();
    expect(isTestSessionLabel(TEST_SESSION)).toBe(true);
  });
  it("deletes children before their parents", () => {
    const describe = (t: string) => ({
      children: t === "attendance_registers" ? [{ table: "attendance_marks", column: "register_id", parentColumn: "id" }] : [],
    });
    const order = resetOrder([{ table: "attendance_registers", where: `session_label = '${TEST_SESSION}'` }], describe);
    expect(order.map((s) => s.table)).toEqual(["attendance_marks", "attendance_registers"]);
    expect(order[0].where).toContain(`register_id" in (select "id" from vppsone."attendance_registers"`);
  });
  it("keeps the TEST timetable", () => {
    expect(RESET_KEEP.has("timetable_versions")).toBe(true);
  });
});

describe("references with no foreign key (review of PR #150)", () => {
  const verifySql = readFileSync(path.join(root, "scripts", "migrate", "verify-quarantine.sql"), "utf8");

  it("verify-quarantine.sql checks exactly the references TABLES lists", () => {
    const block = verifySql.slice(verifySql.indexOf("-- @refs-start"), verifySql.indexOf("-- @refs-end"));
    const inSql = new Set([...block.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z]+)', (true|false)\)/g)].map((m) => `${m[1]}.${m[2]} ${m[3]} ${m[4]}`));
    const listed = new Set<string>();
    for (const [t, spec] of Object.entries(TABLES)) {
      for (const c of spec.staffRefs ?? []) listed.add(`${t}.${c} staff false`);
      for (const c of spec.classRefs ?? []) listed.add(`${t}.${c} class false`);
      for (const c of spec.staffArrays ?? []) listed.add(`${t}.${c} staff true`);
      for (const c of spec.classArrays ?? []) listed.add(`${t}.${c} class true`);
      for (const c of spec.studentArrays ?? []) listed.add(`${t}.${c} student true`);
    }
    expect(listed.size).toBeGreaterThan(10);
    expect(inSql).toEqual(listed);
  });

  it("verify-quarantine.sql's record-answer checks use SENSITIVE_FIELD", () => {
    expect(verifySql.split(`'${SENSITIVE_FIELD.source}'`).length - 1).toBe(6);
  });

  it("the catalog folds listed columns into the class / staff / array lists", () => {
    const cover = info("cover_duties", ["id", "session_label", "absent_staff_ids", "class_ids"], { types: { absent_staff_ids: "uuid[]", class_ids: "uuid[]" } });
    expect(cover.staffArrays).toEqual(["absent_staff_ids"]);
    expect(cover.classArrays).toEqual(["class_ids"]);
    expect(info("substitution_assignments", ["id", "session_label", "class_id", "merge_host_class_id"]).classCols).toEqual(["class_id", "merge_host_class_id"]);
    expect(info("record_commands", ["id", "actor_staff_id"]).staffCols).toEqual(["actor_staff_id"]);
    expect(info("fee_reminder_batches", ["id", "session_label", "student_ids"], { types: { student_ids: "uuid[]" } }).studentArrays).toEqual(["student_ids"]);
  });

  it("unlistedRefColumns stops on a reference-shaped column nobody re-points", () => {
    const fresh = info("notes", ["id", "session_label", "class_id", "student_id", "reviewer_staff_id", "checked_by", "watcher_class_ids", "command_id"], {
      types: { watcher_class_ids: "uuid[]" },
    });
    expect(unlistedRefColumns({ notes: fresh })).toEqual(["notes.checked_by", "notes.reviewer_staff_id", "notes.watcher_class_ids"]);
    // A foreign key covers it; K / C tables are never touched; text columns are not references.
    const fk = info("notes", ["id", "session_label", "checked_by"], { staff: ["checked_by"] });
    expect(unlistedRefColumns({ notes: fk })).toEqual([]);
    expect(unlistedRefColumns({ smoke_pool: info("smoke_pool", ["email", "owner_by"], { pk: ["email"] }) })).toEqual([]);
    expect(unlistedRefColumns({ notes: info("notes", ["id", "made_by"], { types: { made_by: "text" } }) })).toEqual([]);
  });

  it("unlistedRefColumns reports a listed column the table no longer has", () => {
    expect(unlistedRefColumns({ record_commands: info("record_commands", ["id", "session_label"]) })).toEqual(["record_commands.actor_staff_id"]);
  });

  it("planTableOps re-points the listed references, scalar and array", () => {
    const maps = { classMap: new Map([[A, B]]), studentMap: new Map([[C, D]]), staffMap: new Map([[A, B]]) };
    const cover = planTableOps(info("cover_duties", ["id", "session_label", "absent_staff_ids", "class_ids"], { types: { absent_staff_ids: "uuid[]", class_ids: "uuid[]" } }), maps);
    expect(cover.map((o) => `${o.kind}:${o.column}`)).toEqual(["relabel:session_label", "class:class_ids", "staff:absent_staff_ids"]);
    expect(cover[1].set).toContain("unnest(t.\"class_ids\")");
    const batches = planTableOps(info("fee_reminder_batches", ["id", "session_label", "student_ids", "status"], { types: { student_ids: "uuid[]" } }), maps);
    expect(batches.map((o) => `${o.kind}:${o.column}`)).toContain("student:student_ids");
    const subs = planTableOps(info("substitution_assignments", ["id", "session_label", "class_id", "merge_host_class_id"]), maps);
    expect(subs.filter((o) => o.kind === "class").map((o) => o.column)).toEqual(["class_id", "merge_host_class_id"]);
    const commands = planTableOps(info("record_commands", ["id", "session_label", "actor_staff_id"]), maps);
    expect(commands.map((o) => `${o.kind}:${o.column}`)).toContain("staff:actor_staff_id");
  });

  it("planTableOps nulls record answers to phone / identifier fields (records, history, submissions)", () => {
    const maps = { classMap: new Map(), studentMap: new Map(), staffMap: new Map() };
    const records = planTableOps(info("student_records", ["id", "session_label", "field_id", "value"]), maps).find((o) => o.kind === "scrub")!;
    expect(records.set).toBe(`"value" = null`);
    expect(records.where).toContain("vppsone.collection_fields f where f.id = t.field_id");
    const history = planTableOps(info("student_record_history", ["id", "session_label", "field_id", "old_value", "new_value"]), maps).find((o) => o.kind === "scrub")!;
    expect(history.set).toBe(`"old_value" = null, "new_value" = null`);
    const subs = planTableOps(info("collection_submissions", ["id", "field_id", "value", "previous_value", "student_id"]), maps).find((o) => o.kind === "scrub")!;
    expect(subs.where).toContain(`(true)`);
  });
});

describe("held real-teacher candidates (critique0 #20, critique1 A4)", () => {
  const base = { role: "teacher", is_active: true, is_teaching: true, is_test_account: true, created_at: "1" };
  const profiles = [
    { ...base, id: A, short_name: "RK", display_name: "R K", user_id: "u1" },
    { ...base, id: B, short_name: "DR", display_name: "D R", user_id: "u2", in_dayrun: true },
    { ...base, id: C, short_name: "QN", display_name: "QA teacher 3", user_id: "u3" },
  ];
  it("holds a day-run profile and a QA-looking name; promotes the rest", () => {
    const { candidates, held } = splitCandidates(profiles, ["RK", "DR", "QN"]);
    expect(candidates.map((p) => p.id)).toEqual([A]);
    expect(held.map((p) => p.id)).toEqual([B, C]);
    expect(promoteCandidates(profiles, ["RK", "DR", "QN"]).map((p) => p.id)).toEqual([A]);
  });
  it("--accept-held releases exactly the named short names", () => {
    const { candidates, held } = splitCandidates(profiles, ["RK", "DR", "QN"], { acceptHeld: ["dr"] });
    expect(candidates.map((p) => p.id)).toEqual([A, B]);
    expect(held.map((p) => p.id)).toEqual([C]);
    expect(parseAcceptHeld("DR, QN")).toEqual(["DR", "QN"]);
    expect(parseAcceptHeld(undefined)).toEqual([]);
    expect(parseAcceptHeld(true)).toEqual([]);
  });
  it("a held profile gets no twin and stays a test account (maps to itself)", () => {
    const { candidates } = splitCandidates(profiles, ["RK", "DR", "QN"]);
    const r = planStaffMap(profiles, candidates);
    expect(r.twins.map((t) => t.source)).toEqual([A]);
    expect(r.map.has(B)).toBe(false);
    expect(r.map.has(C)).toBe(false);
  });
  it("the quarantine refuses while one is held; a rehearsal does not", () => {
    const ok = { environment: "production", feeWritesEnabled: "false", hasCutover: false, previousApplied: 0, backup: { ok: true } };
    expect(decideQuarantineGuard({ ...ok, held: 2 }).ok).toBe(false);
    expect(decideQuarantineGuard({ ...ok, held: 2 }).reasons.join(" ")).toMatch(/--accept-held/);
    expect(decideQuarantineGuard({ ...ok, held: 2, rollbackOnly: true }).ok).toBe(true);
  });
});

describe("reset-test-session after the quarantine (review of PR #150)", () => {
  it("does not count the quarantine's TEST-D- shells against the 150 limit", () => {
    expect(decideReset({ students: 79, shells: 513 }).ok).toBe(true);
    expect(decideReset({ students: 451, shells: 0 }).ok).toBe(false);
    expect(decideReset({ students: Number.NaN }).ok).toBe(false);
    expect(decideReset({ students: 10, blockers: ["x points at TEST activity"] }).ok).toBe(false);
  });
  it("switches a table's delete-guard triggers off for its one DELETE only", () => {
    const step = { table: "student_record_history", where: `session_label = '${TEST_SESSION}'` };
    const statements = resetStatements(step, new Map([["student_record_history", ["student_record_history_append_only"]]]));
    expect(statements).toEqual([
      `alter table vppsone."student_record_history" disable trigger "student_record_history_append_only"`,
      `delete from vppsone."student_record_history" where session_label = '${TEST_SESSION}'`,
      `alter table vppsone."student_record_history" enable trigger "student_record_history_append_only"`,
    ]);
    expect(resetStatements({ table: "notes", where: "true" })).toEqual([`delete from vppsone."notes" where true`]);
  });
  it("every append-only table is one the quarantine rewrites (and so the reset must unguard)", () => {
    const appendOnly = Object.entries(TABLES).filter(([, s]) => s.appendOnly).map(([t]) => t).sort();
    expect(appendOnly).toEqual(["exam_activity", "report_card_issues", "student_record_history"]);
    for (const t of appendOnly) expect(RESET_KEEP.has(t)).toBe(false);
  });
  it("--null-test-phones compares the last ten digits with the allowlist", () => {
    const sql = offListSql("primary_phone");
    expect(sql).toContain(`s."primary_phone" is not null`);
    expect(sql).toContain("vppsone.message_test_recipients");
    expect(sql).toContain("right(regexp_replace(");
  });
});

describe("the TEST timetable after promotion (seed-timetable confined)", () => {
  const staff = [
    { id: "real", short_name: "RK", is_test_account: false },
    { id: "twin", short_name: "T-RK", is_test_account: true },
    { id: "qa", short_name: "QA1", is_test_account: true },
  ];
  it("confined: a promoted short name falls back to its T- twin", () => {
    const m = teacherShortNameMap(staff, { confined: true });
    expect(m.get("rk")).toBe("twin");
    expect(m.get("qa1")).toBe("qa");
  });
  it("production promote: real staff only; neither: everyone", () => {
    expect([...teacherShortNameMap(staff, { realOnly: true })]).toEqual([["rk", "real"]]);
    expect(teacherShortNameMap(staff).get("rk")).toBe("real");
  });
});

describe("the first load refuses unquarantined rows (critique0 #19)", () => {
  it("refuses a first load while a B row carries a real session; a rehearsal warns; later loads pass", () => {
    const leftovers = [{ table: "notes", n: 2 }];
    expect(decideFirstLoadQuarantine({ firstLoad: true, leftovers }).ok).toBe(false);
    expect(decideFirstLoadQuarantine({ firstLoad: true, rollbackOnly: true, leftovers })).toMatchObject({ ok: true, warn: expect.stringContaining("notes 2") });
    expect(decideFirstLoadQuarantine({ firstLoad: false, leftovers }).ok).toBe(true);
    expect(decideFirstLoadQuarantine({ firstLoad: true, leftovers: [] }).ok).toBe(true);
  });
});

describe("repoint-test-class-rows (the one phase-H script applied for real)", () => {
  const classMap = new Map([[A, B]]);
  const ct = info("class_teachers", ["id", "session_label", "class_id", "staff_profile_id", "role", "effective_from", "effective_to"], { staff: ["staff_profile_id"] });
  it("plans the close-duplicate before the re-point, and records both columns' before-state", () => {
    const ops = planTestClassOps(ct, classMap);
    expect(ops.map((o) => o.kind)).toEqual(["close-duplicate", "class"]);
    const q = beforeStateSql(ct, ops);
    expect(q.sql).toContain(`t."id"::text as "id", t."effective_to"::text as "effective_to", t."class_id"::text as "class_id"`);
    expect(q.params).toHaveLength(2); // the close-duplicate WHERE uses the target ids too
  });
  it("the revert writes every recorded column back by primary key, null included", () => {
    const statements = revertStatements([{ table: "class_teachers", pk: ["id"], rows: [{ id: C, effective_to: null, class_id: A }] }]);
    expect(statements).toEqual([{ sql: `update vppsone."class_teachers" set "effective_to" = $2, "class_id" = $3 where "id"::text = $1`, params: [C, null, A] }]);
  });
  it("refuses a table with no primary key", () => {
    expect(() => beforeStateSql({ ...ct, pk: [] }, planTestClassOps(ct, classMap))).toThrow(/primary key/);
  });
});

describe("classify-dev-vppsone", () => {
  it("counts the owner's activity through FK and listed staff references, arrays and auth.users columns", () => {
    const owner = { profile_id: A, user_id: B };
    const cover = info("cover_duties", ["id", "session_label", "absent_staff_ids", "class_ids"], { types: { absent_staff_ids: "uuid[]", class_ids: "uuid[]" } });
    expect(ownerActivityWhere(cover, owner)).toBe(`'${A}'::uuid = any(t."absent_staff_ids")`);
    const withAuth = describeTables({
      tables: { notes: { columns: [{ name: "id", type: "uuid" }, { name: "created_by", type: "uuid" }, { name: "author_staff_id", type: "uuid" }], pk: ["id"], triggers: [] } },
      fks: [
        { name: "a", child: "vppsone.notes", parent: "auth.users", childCols: ["created_by"] },
        { name: "b", child: "vppsone.notes", parent: "vppsone.staff_profiles", childCols: ["author_staff_id"] },
      ],
    }).notes;
    expect(ownerActivityWhere(withAuth, owner)).toBe(`t."author_staff_id" = '${A}'::uuid or t."created_by" = '${B}'::uuid`);
    expect(ownerActivityWhere(info("subjects", ["id", "code"]), owner)).toBeNull();
    expect(() => ownerActivityWhere(withAuth, { profile_id: "x'; drop", user_id: B })).toThrow();
  });
  it("finds rows on the extra class through class arrays too", () => {
    expect(classRefsWhere(info("cover_duties", ["id", "class_ids"], { types: { class_ids: "uuid[]" } }))).toBe(`t."class_ids" && $1::uuid[]`);
    expect(classRefsWhere(info("subjects", ["id"]))).toBeNull();
  });
});

describe("the runbook runs C8 while fee writes are still shut", () => {
  it("C8 (rebuild-enrolments --apply, which refuses after fee_writes_enabled='true') comes before step 8", () => {
    const runbook = readFileSync(path.join(root, "docs", "cutover", "CUTOVER-RUNBOOK-2026-27.md"), "utf8");
    const c8 = runbook.indexOf("### C8 — enrolments");
    const step5 = runbook.indexOf("### Step 5 — Reconcile");
    const step8 = runbook.indexOf("### Step 8 — Enable real fee writes");
    expect(c8).toBeGreaterThan(step5);
    expect(c8).toBeLessThan(step8);
    expect(decideEnrolmentRebuild({ environment: "production", feeWritesEnabled: "true", hasCutover: true, firstLoads: 1 }).ok).toBe(false);
  });
});

describe("load-snapshot's real-data marker", () => {
  it("says REAL and lists nothing masked", () => {
    const m = realDataMarker({ runId: "t0-x", manifest: { tables: [{ rowCount: 2 }, { rowCount: 3 }], watermark: { newestChangeAt: "w" } } });
    expect(m).toMatchObject({ tables_copied: 2, rows_copied: 5, masked_columns: {}, source_project: "vgqyilgstjvgohrsiwkb", target_project: "wtgxcptmucjerhufzjcf" });
    expect(m.note).toMatch(/^REAL fee data/);
  });
});
