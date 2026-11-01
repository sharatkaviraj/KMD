import { describe, expect, it } from "vitest";

import { oneRoleForFeeRole, planAuthImport, remapUserReferences, shortNameFor } from "../scripts/migrate/lib/auth-import.mjs";
import { authSettingsUrl, readSignupDisabled } from "../scripts/migrate/lib/auth-settings.mjs";
import { matviewOrder } from "../scripts/migrate/lib/catalog.mjs";
import {
  compareWithMcp,
  moneySegment,
  rowInScope,
  sessionMoneySummary,
  summarizeFinancialRows,
} from "../scripts/migrate/lib/control-totals.mjs";
import { loadOrder, planLoad, summarizePlan } from "../scripts/migrate/lib/diff.mjs";
import { parseArgs, parseEnvText } from "../scripts/migrate/lib/env.mjs";
import { decideLoadGuard, decideStorageGuard, decideTailGuard } from "../scripts/migrate/lib/guards.mjs";
import {
  classifyTestRows,
  importTransform,
  isOneOwnedAppSetting,
  isTestSessionLabel,
  protectedRows,
  TERMINAL_RULES,
} from "../scripts/migrate/lib/import-rules.mjs";
import { fingerprintDrift, relationsFromOpenApi } from "../scripts/migrate/lib/live-read.mjs";
import {
  checksumMismatches,
  onlineInvariant,
  receiptFigures,
  studentChecksums,
} from "../scripts/migrate/lib/reconcile-checks.mjs";
import { canonical, orderedMd5, pkKey } from "../scripts/migrate/lib/rows.mjs";
import { open, seal } from "../scripts/migrate/lib/secrets-box.mjs";
import { storageCopyPlan } from "../scripts/migrate/lib/storage-list.mjs";
import { afterWatermark, classifyTailChange, reviewRow, tailAction, tailEnd } from "../scripts/migrate/lib/tail.mjs";
import { deleteKeyRows } from "../scripts/migrate/load-snapshot.mjs";
import { isTestChange, rollbackCategory } from "../scripts/migrate/rollback-export.mjs";
import { newestChange, pickAuthUsers } from "../scripts/migrate/extract-live.mjs";

/**
 * Phase A2 migration tooling: the pure logic every script runs on. Synthetic
 * rows only — no real student, phone or receipt (rule 6).
 */

type Row = Record<string, unknown>;

/* ------------------------------------------------------------ fixtures */

const col = (name: string, extra: Row = {}) => ({ name, type: "text", notNull: false, generated: false, identity: false, ...extra });

/** A small fee schema: sessions via classes, students in classes, receipts and installments keyed on students. */
const META = {
  tables: {
    app_settings: { columns: [col("key"), col("value")], pk: ["key"], uniques: [], triggers: [], sequences: [] },
    classes: { columns: [col("id"), col("session_label"), col("class_name")], pk: ["id"], uniques: [], triggers: [], sequences: [] },
    fee_policy_configs: { columns: [col("id"), col("academic_session_label"), col("receipt_prefix")], pk: ["id"], uniques: [], triggers: [], sequences: [] },
    students: { columns: [col("id"), col("admission_no"), col("class_id"), col("status")], pk: ["id"], uniques: [["admission_no"]], triggers: ["audit_students"], sequences: [] },
    receipts: { columns: [col("id"), col("receipt_number"), col("student_id"), col("total_amount"), col("payment_mode")], pk: ["id"], uniques: [["receipt_number"]], triggers: ["receipts_are_append_only"], sequences: [] },
    installments: {
      columns: [col("id"), col("student_id"), col("carry_forward_balance_id"), col("amount_due", { generated: true })],
      pk: ["id"],
      uniques: [],
      triggers: [],
      sequences: [],
    },
    student_carry_forward_balances: { columns: [col("id"), col("student_id"), col("backing_installment_id")], pk: ["id"], uniques: [], triggers: [], sequences: [] },
    online_payment_orders: { columns: [col("id"), col("status")], pk: ["id"], uniques: [], triggers: [], sequences: [] },
    audit_logs: { columns: [col("id"), col("table_name"), col("record_id")], pk: ["id"], uniques: [], triggers: [], sequences: [] },
    users: { columns: [col("id")], pk: ["id"], uniques: [], triggers: [], sequences: [] },
  },
  fks: [
    { name: "students_class_id_fkey", child: "students", childCols: ["class_id"], parentSchema: "public", parent: "classes", parentCols: ["id"], onDelete: "r", nullable: false },
    { name: "receipts_student_id_fkey", child: "receipts", childCols: ["student_id"], parentSchema: "public", parent: "students", parentCols: ["id"], onDelete: "r", nullable: false },
    { name: "installments_student_id_fkey", child: "installments", childCols: ["student_id"], parentSchema: "public", parent: "students", parentCols: ["id"], onDelete: "c", nullable: false },
    { name: "installments_cf_fkey", child: "installments", childCols: ["carry_forward_balance_id"], parentSchema: "public", parent: "student_carry_forward_balances", parentCols: ["id"], onDelete: "n", nullable: true },
    { name: "cf_backing_fkey", child: "student_carry_forward_balances", childCols: ["backing_installment_id"], parentSchema: "public", parent: "installments", parentCols: ["id"], onDelete: "r", nullable: false },
    { name: "cf_student_fkey", child: "student_carry_forward_balances", childCols: ["student_id"], parentSchema: "public", parent: "students", parentCols: ["id"], onDelete: "r", nullable: false },
    { name: "users_id_fkey", child: "users", childCols: ["id"], parentSchema: "auth", parent: "users", parentCols: ["id"], onDelete: "c", nullable: false },
  ],
};

const REAL_CLASS = { id: "c-real", session_label: "2026-27", class_name: "6" };
const TEST_CLASS = { id: "c-test", session_label: "TEST-2026-27", class_name: "6" };

function db(tables: Record<string, Row[]>) {
  return new Map(Object.entries(tables));
}

function baseSource(): Map<string, Row[]> {
  return db({
    classes: [REAL_CLASS, TEST_CLASS],
    students: [
      { id: "s1", admission_no: "A-1", class_id: "c-real", status: "active" },
      { id: "s2", admission_no: "A-2", class_id: "c-real", status: "left" },
      { id: "t1", admission_no: "T-1", class_id: "c-test", status: "active" },
    ],
    receipts: [
      { id: "r1", receipt_number: "SVP20261030-0001", student_id: "s1", total_amount: 100, payment_mode: "cash" },
      { id: "rt", receipt_number: "SVP20261030-0002", student_id: "t1", total_amount: 50, payment_mode: "cash" },
    ],
    installments: [],
    student_carry_forward_balances: [],
    app_settings: [
      { key: "active_session_label", value: "2026-27" },
      { key: "online_payment_links_enabled", value: "true" },
      { key: "fee_writes_enabled", value: "true" },
    ],
    fee_policy_configs: [
      { id: "p1", academic_session_label: "2026-27", receipt_prefix: "SVP" },
      { id: "pt", academic_session_label: "TEST-2026-27", receipt_prefix: "SVP" },
    ],
    online_payment_orders: [
      { id: "o1", status: "open" },
      { id: "o2", status: "accounted" },
    ],
  });
}

function baseTarget(): Map<string, Row[]> {
  return db({
    classes: [REAL_CLASS, TEST_CLASS],
    students: [
      { id: "s1", admission_no: "A-1", class_id: "c-real", status: "active" },
      { id: "s2", admission_no: "A-2", class_id: "c-real", status: "active" }, // changed on live
      { id: "s9", admission_no: "A-9", class_id: "c-real", status: "active" }, // gone from live
      { id: "t1", admission_no: "T-1", class_id: "c-test", status: "active" },
      { id: "shell", admission_no: "TEST-D-0001", class_id: "c-test", status: "active" },
    ],
    receipts: [
      { id: "rq", receipt_number: "TST20261030-0001", student_id: "t1", total_amount: 10, payment_mode: "cash" }, // One's own test posting
      { id: "rs", receipt_number: "TST20261030-0002", student_id: "shell", total_amount: 10, payment_mode: "cash" },
    ],
    installments: [],
    student_carry_forward_balances: [],
    app_settings: [
      { key: "active_session_label", value: "2026-27" },
      { key: "online_payment_links_enabled", value: "false" },
      { key: "receipt_suffix_floor", value: "5000" },
    ],
    fee_policy_configs: [
      { id: "p1", academic_session_label: "2026-27", receipt_prefix: "SVP" },
      { id: "pt", academic_session_label: "TEST-2026-27", receipt_prefix: "TST" },
    ],
    online_payment_orders: [],
  });
}

const ONE_OWNED = [
  { source_table: "app_settings", row_key: "fee_writes_enabled", column_name: "value" },
  { source_table: "fee_policy_configs", row_key: "TEST-2026-27", column_name: "receipt_prefix" },
];

function plan(options: { firstLoad?: boolean; idMap?: Row[]; source?: Map<string, Row[]>; target?: Map<string, Row[]> } = {}) {
  return planLoad({
    meta: META,
    source: options.source ?? baseSource(),
    target: options.target ?? baseTarget(),
    idMap: options.idMap ?? [],
    oneOwned: ONE_OWNED,
    firstLoad: options.firstLoad ?? false,
    feesRef: "vgqyilgstjvgohrsiwkb",
  });
}

/* --------------------------------------------------------------- tests */

describe("control totals (ported from the fees MCP)", () => {
  const rows = [
    { session_label: "2026-27", class_id: "c1", record_status: "active", total_paid: 0, base_charge_total: 1000, outstanding_amount: 1000, late_fee_outstanding_amount: 0, late_fee_total: 0, late_fee_waiver_amount: 0, discount_amount: 0, total_discount_closeouts: 0, overdue_installment_count: 1 },
    { session_label: "2026-27", class_id: "c1", record_status: "active", total_paid: 400, base_charge_total: 1000, outstanding_amount: 600, late_fee_outstanding_amount: 250, late_fee_total: 1000, late_fee_waiver_amount: 750, discount_amount: 100, total_discount_closeouts: 0, overdue_installment_count: 0 },
    { session_label: "2026-27", class_id: "c2", record_status: "left", total_paid: 300, base_charge_total: 300, outstanding_amount: 0, late_fee_outstanding_amount: 0, late_fee_total: 0, late_fee_waiver_amount: 0, discount_amount: 0, total_discount_closeouts: 0, overdue_installment_count: 0 },
    { session_label: "2026-27", class_id: "c2", record_status: "left", total_paid: 0, base_charge_total: 500, outstanding_amount: 500, late_fee_outstanding_amount: 0, late_fee_total: 0, late_fee_waiver_amount: 0, discount_amount: 0, total_discount_closeouts: 0, overdue_installment_count: 0 },
    { session_label: "TEST-2026-27", class_id: "c3", record_status: "active", total_paid: 9, base_charge_total: 9, outstanding_amount: 0, late_fee_outstanding_amount: 0, late_fee_total: 0, late_fee_waiver_amount: 0, discount_amount: 0, total_discount_closeouts: 0, overdue_installment_count: 0 },
  ];

  it("headcount is on roll; money is on roll OR paid something", () => {
    expect(rowInScope(rows[2], "on_roll")).toBe(false);
    expect(rowInScope(rows[2], "collectable")).toBe(true);
    expect(rowInScope(rows[3], "collectable")).toBe(false);
    expect(() => rowInScope(rows[0], "active")).toThrow(/Every read must name/);
  });

  it("summarises one session exactly as get_session_money_summary does", () => {
    const summary = sessionMoneySummary(rows, "2026-27");
    expect(summary.headcount.studentsOnRoll).toBe(2);
    expect(summary.money.studentCount).toBe(3);
    expect(summary.money.notOnRollCount).toBe(1);
    expect(summary.money.totalExpectedFees).toBe(2300);
    expect(summary.money.totalPaid).toBe(700);
    expect(summary.money.totalFeesPending).toBe(1600);
    expect(summary.money.totalLateFeePending).toBe(250);
    // Fees and late fee are added only in the named total.
    expect(summary.money.totalCollectable).toBe(1850);
    expect(summary.money.moneySegments).toEqual({ never_paid: 1, partly_paid: 1, year_clear: 1, unclassified: 0 });
  });

  it("moneySegment and summarizeFinancialRows match the fees definitions", () => {
    expect(moneySegment({ total_paid: 0, base_charge_total: 10, outstanding_amount: 10 })).toBe("never_paid");
    expect(moneySegment({ total_paid: 0, base_charge_total: 0, outstanding_amount: 0 })).toBe("unclassified");
    expect(summarizeFinancialRows([]).studentCount).toBe(0);
  });

  it("compares field by field with an MCP payload", () => {
    const ours = sessionMoneySummary(rows, "2026-27");
    expect(compareWithMcp(ours, { headcount: { studentsOnRoll: 2 }, money: { totalPaid: 700, totalExpectedFees: 2300 } })).toEqual([]);
    expect(compareWithMcp(ours, { headcount: { studentsOnRoll: 3 }, money: { totalPaid: 701 } })).toEqual([
      { field: "headcount.studentsOnRoll", ours: 2, theirs: 3 },
      { field: "money.totalPaid", ours: 700, theirs: 701 },
    ]);
  });
});

describe("import rules", () => {
  it("knows a test session label", () => {
    expect(isTestSessionLabel("TEST-2026-27")).toBe(true);
    expect(isTestSessionLabel("uat-2026-27")).toBe(true);
    expect(isTestSessionLabel("2026-27")).toBe(false);
    expect(isTestSessionLabel(null)).toBe(false);
  });

  it("imports online and outbox rows only in states One's loops ignore", () => {
    expect(importTransform("online_payment_orders", { status: "open" })).toEqual({ row: { status: "abandoned" }, action: "rewritten" });
    expect(importTransform("online_payment_orders", { status: "paid" }).row?.status).toBe("abandoned");
    expect(importTransform("online_payment_orders", { status: "accounted" }).action).toBe("keep");
    expect(importTransform("online_payment_intents", { status: "link_created" }).row?.status).toBe("cancelled");
    expect(importTransform("online_payment_events", { status: "failed" }).row?.status).toBe("ignored");
    expect(importTransform("online_payment_events", { status: "processed" }).action).toBe("keep");
    expect(importTransform("online_payment_captures", { application_status: "pending" })).toEqual({ row: null, action: "dropped" });
    expect(importTransform("online_payment_captures", { application_status: "review_required" }).action).toBe("dropped");
    expect(importTransform("online_payment_captures", { application_status: "applied" }).action).toBe("keep");
    expect(importTransform("notification_outbox", { status: "queued", locked_until: "x" }).row).toEqual({ status: "suppressed", locked_until: null });
    expect(importTransform("notification_outbox", { status: "failed" }).row?.status).toBe("suppressed");
    expect(importTransform("notification_outbox", { status: "delivered" }).action).toBe("keep");
    expect(importTransform("receipts", { id: "x" }).action).toBe("keep");
  });

  it("every rewrite target is itself terminal (and allowed by the table's check)", () => {
    for (const rule of Object.values(TERMINAL_RULES)) {
      if (rule.rewrite !== null) expect(rule.terminal).toContain(rule.rewrite);
    }
  });

  it("names the One-owned app settings", () => {
    for (const key of ["online_payment_links_enabled", "online_payment_waive_late_fees", "whatsapp_receipt_notice_enabled", "whatsapp_reversal_notice_enabled", "receipt_suffix_floor", "staff_whatsapp_month_cap", "fee_writes_enabled"]) {
      expect(isOneOwnedAppSetting(key), key).toBe(true);
    }
    expect(isOneOwnedAppSetting("active_session_label")).toBe(false);
    expect(isOneOwnedAppSetting("whatsapp_month_message_cap")).toBe(false);
  });

  it("follows TEST sessions down every foreign key, and attaches audit rows", () => {
    const rows = baseSource();
    rows.set("audit_logs", [
      { id: "a1", table_name: "receipts", record_id: "rt" },
      { id: "a2", table_name: "receipts", record_id: "r1" },
    ]);
    const test = classifyTestRows(rows, META);
    expect([...(test.get("classes") ?? [])]).toEqual(["c-test"]);
    expect([...(test.get("students") ?? [])]).toEqual(["t1"]);
    expect([...(test.get("receipts") ?? [])]).toEqual(["rt"]);
    expect([...(test.get("fee_policy_configs") ?? [])]).toEqual(["pt"]);
    expect([...(test.get("audit_logs") ?? [])]).toEqual(["a1"]);
  });

  it("protects quarantine shells, id-map targets and what hangs off them", () => {
    const target = baseTarget();
    const prot = protectedRows(target, META, [{ source_project: "wtgxcptmucjerhufzjcf", source_table: "public.receipts", source_id: "old", target_id: "rq" }]);
    expect([...(prot.get("students") ?? [])]).toEqual(["shell"]);
    expect([...(prot.get("receipts") ?? [])].sort()).toEqual(["rq", "rs"]);
  });
});

describe("planLoad", () => {
  it("inserts, updates and deletes real rows, and never touches TEST rows after the first load", () => {
    const p = plan();
    expect(p.tables.students.update).toEqual(["s2"]);
    expect(p.tables.students.delete).toEqual(["s9"]);
    expect(p.tables.students.counts.test).toBe(1); // t1
    expect(p.tables.students.counts.testKept).toBe(0);
    expect(p.tables.receipts.insert).toEqual(["r1"]);
    expect(p.tables.receipts.delete).toEqual([]); // rq is One's TEST receipt, rs is protected
    expect(p.tables.receipts.counts.test).toBe(1); // rt from live
    expect(p.tables.receipts.counts.testKept).toBe(1);
    expect(p.tables.receipts.counts.protectedKept).toBe(1);
  });

  it("copies TEST rows from live on --first-load, but never deletes One's own TEST rows", () => {
    const p = plan({ firstLoad: true });
    expect(p.tables.receipts.insert.sort()).toEqual(["r1", "rt"]);
    expect(p.tables.receipts.delete).toEqual([]);
    expect(p.tables.receipts.counts.testKept).toBe(1);
  });

  it("keeps protected rows and counts a live row that collides with one", () => {
    const source = baseSource();
    source.get("students")!.push({ id: "shell", admission_no: "X", class_id: "c-real", status: "active" });
    const p = plan({ source });
    expect(p.tables.students.counts.protectedConflict).toBe(1);
    expect(p.tables.students.update).not.toContain("shell");
    expect(p.tables.students.delete).not.toContain("shell");
  });

  it("never inserts, updates or deletes One-owned settings, and keeps One-owned cells", () => {
    const p = plan({ firstLoad: true });
    expect(p.tables.app_settings.insert).toEqual([]);
    expect(p.tables.app_settings.update).toEqual([]);
    expect(p.tables.app_settings.delete).toEqual([]);
    expect(p.tables.app_settings.counts.owned).toBe(2);
    expect(p.tables.app_settings.counts.ownedKept).toBe(1); // receipt_suffix_floor
    // TEST-2026-27 stays TST even on the first load.
    expect(p.tables.fee_policy_configs.update).toEqual([]);
    expect(p.tables.fee_policy_configs.counts.ownedCells).toBe(1);
  });

  it("applies the terminal rules before diffing", () => {
    const p = plan();
    expect(p.tables.online_payment_orders.insert.sort()).toEqual(["o1", "o2"]);
    expect(p.tables.online_payment_orders.rows.get("o1")?.status).toBe("abandoned");
    expect(p.tables.online_payment_orders.counts.rewritten).toBe(1);
  });

  it("skips rows the fees project re-keyed through migration_id_map", () => {
    const p = plan({ idMap: [{ source_project: "vgqyilgstjvgohrsiwkb", source_table: "public.receipts", source_id: "r1", target_id: "new" }] });
    expect(p.tables.receipts.insert).toEqual([]);
    expect(p.tables.receipts.counts.rekeyed).toBe(1);
  });

  it("blocks a delete that would orphan a row that stays", () => {
    const target = baseTarget();
    target.get("receipts")!.push({ id: "rk", receipt_number: "TST20261030-0003", student_id: "s9", total_amount: 1, payment_mode: "cash" });
    // rk is a real-session receipt One has and live does not: it is deleted, so s9 may go too.
    expect(plan({ target }).tables.students.delete).toEqual(["s9"]);
    // A protected shell that stays and points at a real class live no longer has keeps that class.
    const t2 = baseTarget();
    t2.get("classes")!.push({ id: "c-gone", session_label: "2026-27", class_name: "7" });
    t2.get("students")!.push({ id: "t2", admission_no: "TEST-D-0002", class_id: "c-gone", status: "active" });
    const p = plan({ target: t2 });
    expect(p.tables.classes.delete).toEqual([]);
    expect(p.tables.classes.counts.blockedDelete).toBe(1);
  });

  it("predicts orphans and unique collisions before anything is written", () => {
    const source = baseSource();
    source.get("receipts")!.push({ id: "r-orphan", receipt_number: "SVP20261030-0009", student_id: "nobody", total_amount: 1, payment_mode: "cash" });
    source.get("receipts")!.push({ id: "r-dup", receipt_number: "TST20261030-0001", student_id: "s1", total_amount: 1, payment_mode: "cash" });
    const p = plan({ source });
    expect(p.orphans).toEqual([{ constraint: "receipts_student_id_fkey", child: "receipts", parent: "students", count: 1 }]);
    expect(p.uniqueConflicts).toEqual([{ table: "receipts", columns: ["receipt_number"], duplicates: 1 }]);
    const summary = summarizePlan(p);
    expect(summary.totals.insert).toBeGreaterThan(0);
  });

  it("collects references to auth.users for the caller to check", () => {
    const source = baseSource();
    source.set("users", [{ id: "u1" }]);
    const p = plan({ source });
    const ref = p.external.find((e: { constraint: string }) => e.constraint === "users_id_fkey");
    expect(ref?.parent).toBe("auth.users");
    expect([...(ref?.tuples ?? [])]).toEqual([JSON.stringify(["u1"])]);
  });

  it("never compares generated columns", () => {
    const source = baseSource();
    source.set("installments", [{ id: "i1", student_id: "s1", carry_forward_balance_id: null, amount_due: 5 }]);
    const target = baseTarget();
    target.set("installments", [{ id: "i1", student_id: "s1", carry_forward_balance_id: null, amount_due: 999 }]);
    const p = plan({ source, target });
    expect(p.tables.installments.columns).not.toContain("amount_due");
    expect(p.tables.installments.unchanged).toBe(1);
  });
});

describe("load order", () => {
  it("puts parents first and defers the nullable side of a cycle", () => {
    const { order, deferred } = loadOrder(META, ["students", "classes", "installments", "student_carry_forward_balances", "receipts"]);
    expect(order.indexOf("classes")).toBeLessThan(order.indexOf("students"));
    expect(order.indexOf("students")).toBeLessThan(order.indexOf("receipts"));
    expect(order.indexOf("installments")).toBeLessThan(order.indexOf("student_carry_forward_balances"));
    expect(deferred).toEqual({ installments: ["carry_forward_balance_id"] });
  });

  it("ignores foreign keys to other schemas (public.users -> auth.users is not a self-reference)", () => {
    expect(() => loadOrder(META, ["users"])).not.toThrow();
  });

  it("refuses a cycle with no nullable column", () => {
    const meta = {
      tables: { a: { pk: ["id"] }, b: { pk: ["id"] } },
      fks: [
        { name: "a_b", child: "a", childCols: ["b_id"], parent: "b", parentCols: ["id"], nullable: false },
        { name: "b_a", child: "b", childCols: ["a_id"], parent: "a", parentCols: ["id"], nullable: false },
      ],
    };
    expect(() => loadOrder(meta, ["a", "b"])).toThrow(/cycle/);
  });

  it("orders matviews after the ones they read", () => {
    expect(
      matviewOrder([
        { relname: "v_student_financial_state", uses: ["v_workbook_student_financials"] },
        { relname: "v_workbook_student_financials", uses: ["v_workbook_installment_balances"] },
        { relname: "v_workbook_installment_balances", uses: [] },
      ]),
    ).toEqual(["v_workbook_installment_balances", "v_workbook_student_financials", "v_student_financial_state"]);
  });

  it("turns pk strings back into key rows", () => {
    expect(deleteKeyRows(["a"], ["id"])).toEqual([{ id: "a" }]);
    expect(deleteKeyRows([JSON.stringify(["r", "s"])], ["run_id", "student_id"])).toEqual([{ run_id: "r", student_id: "s" }]);
  });
});

describe("guards", () => {
  const prod = { environment: "production", hasCutover: false, feeWritesEnabled: "false", feeWritesOpen: false, signupDisabled: true, previousApplied: 0 };

  it("load-snapshot refuses a real load while public sign-ups are on, or unreadable (plan §6 Q21)", () => {
    expect(decideLoadGuard({ ...prod, signupDisabled: false }).ok).toBe(false);
    expect(decideLoadGuard({ ...prod, signupDisabled: false }).reasons[0]).toMatch(/Public sign-ups are on/);
    expect(decideLoadGuard({ ...prod, signupDisabled: null }).reasons[0]).toMatch(/Could not read whether public sign-ups are off/);
    expect(decideLoadGuard({ ...prod, signupDisabled: undefined }).ok).toBe(false);
    // --allow-dev-target and --first-load never lift it; a rehearsal that
    // always rolls back persists nothing, so it may run.
    expect(decideLoadGuard({ ...prod, environment: "dev", allowDevTarget: true, signupDisabled: false }).ok).toBe(false);
    expect(decideLoadGuard({ ...prod, firstLoad: true, signupDisabled: false }).ok).toBe(false);
    expect(decideLoadGuard({ ...prod, signupDisabled: false, rollbackOnly: true }).ok).toBe(true);
  });

  it("reads disable_signup from One's own project only, and counts anything odd as unreadable", async () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://wtgxcptmucjerhufzjcf.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    const calls: { url: string; init: { headers: Record<string, string> } }[] = [];
    // The reader only needs fetch's shape; cast once rather than build a Response.
    const fetchWith = (body: unknown, ok = true) =>
      (async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, init });
        return { ok, json: async () => body };
      }) as unknown as typeof fetch;
    expect(await readSignupDisabled(env, { fetchImpl: fetchWith({ disable_signup: true }) })).toBe(true);
    expect(calls[0].url).toBe("https://wtgxcptmucjerhufzjcf.supabase.co/auth/v1/settings");
    expect(calls[0].init.headers.apikey).toBe("sb_publishable_test");
    expect(await readSignupDisabled(env, { fetchImpl: fetchWith({ disable_signup: false }) })).toBe(false);
    expect(await readSignupDisabled(env, { fetchImpl: fetchWith({}) })).toBeNull();
    expect(await readSignupDisabled(env, { fetchImpl: fetchWith({ disable_signup: true }, false) })).toBeNull();
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await readSignupDisabled(env, { fetchImpl: throwing })).toBeNull();
    // The fees project, or any other host, is never asked.
    expect(authSettingsUrl({ NEXT_PUBLIC_SUPABASE_URL: "https://vgqyilgstjvgohrsiwkb.supabase.co" })).toBeNull();
    expect(authSettingsUrl({ NEXT_PUBLIC_SUPABASE_URL: "http://wtgxcptmucjerhufzjcf.supabase.co" })).toBeNull();
    expect(await readSignupDisabled({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }, { fetchImpl: fetchWith({ disable_signup: true }) })).toBeNull();
  });

  it("load-snapshot refuses after cutover, while fee writes are on, and off production", () => {
    expect(decideLoadGuard(prod).ok).toBe(true);
    expect(decideLoadGuard({ ...prod, hasCutover: true }).ok).toBe(false);
    expect(decideLoadGuard({ ...prod, feeWritesEnabled: "TRUE " }).ok).toBe(false);
    // The database's own rule decides "open": on a dev-marked target a missing
    // key is open, and the string check alone would have let the load through.
    expect(decideLoadGuard({ ...prod, environment: "dev", allowDevTarget: true, feeWritesEnabled: null, feeWritesOpen: true }).ok).toBe(false);
    // Unreadable counts as open.
    expect(decideLoadGuard({ ...prod, feeWritesOpen: null }).reasons[0]).toMatch(/could not be read/);
    expect(decideLoadGuard({ ...prod, feeWritesOpen: undefined }).ok).toBe(false);
    // A rehearsal that always rolls back lifts env + fee-writes, never cutover.
    expect(decideLoadGuard({ ...prod, environment: "dev", feeWritesOpen: true, rollbackOnly: true }).ok).toBe(true);
    expect(decideLoadGuard({ ...prod, hasCutover: true, rollbackOnly: true }).ok).toBe(false);
    expect(decideLoadGuard({ ...prod, environment: "dev" }).reasons[0]).toMatch(/allow-dev-target/);
    expect(decideLoadGuard({ ...prod, environment: null }).ok).toBe(false);
    expect(decideLoadGuard({ ...prod, environment: "dev", allowDevTarget: true }).ok).toBe(true);
    // --allow-dev-target never lifts the cutover or fee-writes refusals.
    expect(decideLoadGuard({ ...prod, environment: "dev", allowDevTarget: true, hasCutover: true }).ok).toBe(false);
  });

  it("copies TEST rows from live once only", () => {
    expect(decideLoadGuard({ ...prod, firstLoad: true }).ok).toBe(true);
    expect(decideLoadGuard({ ...prod, firstLoad: true, previousApplied: 1 }).ok).toBe(false);
  });

  it("tail-sync needs a cutover; storage-copy needs production", () => {
    expect(decideTailGuard({ environment: "production", hasCutover: false }).ok).toBe(false);
    expect(decideTailGuard({ environment: "production", hasCutover: true }).ok).toBe(true);
    expect(decideStorageGuard({ environment: "dev" }).ok).toBe(false);
    expect(decideStorageGuard({ environment: "production" }).ok).toBe(true);
  });
});

describe("the tail", () => {
  it("ends at the later of Path B + 21 days and the latest Path A expiry", () => {
    const sends = [
      { pay_code: "a", pay_scope: { students: [] }, created_at: "2026-11-01T10:00:00Z", pay_code_expires_on: "2026-11-05" },
      { pay_code: "b", pay_scope: null, created_at: "2026-10-01T10:00:00Z", pay_code_expires_on: "2026-12-31" },
      { pay_code: null, created_at: "2026-12-01T10:00:00Z" },
    ];
    expect(tailEnd(sends, { asOf: "2026-11-30" })).toEqual({
      pathBEnd: "2026-11-22",
      pathAEnd: "2026-12-31",
      tailEnd: "2026-12-31",
      openEndedPayCodes: 0,
      openPathA: 1,
      openPathB: 0,
    });
  });

  it("is open-ended while any pay code has no expiry", () => {
    expect(tailEnd([{ pay_code: "x", pay_code_expires_on: null, created_at: "2026-10-01T00:00:00Z" }]).tailEnd).toBeNull();
  });

  it("reads audit rows after the watermark, ties included unless in the snapshot", () => {
    const mark = { auditMaxCreatedAt: "2026-10-30T12:00:00.000Z", auditIdsAtMax: ["seen"] };
    expect(afterWatermark({ id: "x", created_at: "2026-10-30T12:00:01Z" }, mark)).toBe(true);
    expect(afterWatermark({ id: "x", created_at: "2026-10-30T11:59:59Z" }, mark)).toBe(false);
    expect(afterWatermark({ id: "seen", created_at: "2026-10-30T12:00:00Z" }, mark)).toBe(false);
    expect(afterWatermark({ id: "new", created_at: "2026-10-30T12:00:00Z" }, mark)).toBe(true);
  });

  it("alerts on fees work outside the tail allow-list", () => {
    expect(classifyTailChange("receipts", { payment_mode: "online" }).expected).toBe(true);
    expect(classifyTailChange("receipts", { payment_mode: "cash" }).expected).toBe(false);
    expect(classifyTailChange("payments", { receipt_id: "r" }, { receiptModes: new Map([["r", "online"]]) }).expected).toBe(true);
    expect(classifyTailChange("student_late_fee_waivers", { source: "manual" }).expected).toBe(false);
    expect(classifyTailChange("whatsapp_reminder_sends", { notice_kind: "reminder" }).expected).toBe(false);
    expect(classifyTailChange("whatsapp_reminder_sends", { notice_kind: "receipt" }).expected).toBe(true);
    expect(classifyTailChange("students", { id: "s" }).expected).toBe(false);
    expect(classifyTailChange("online_payment_orders", {}, { op: "DELETE" }).expected).toBe(false);
    expect(classifyTailChange("installments", {}).expected).toBe(true);
  });

  it("queues receipts for review, upserts events, never writes the outbox", () => {
    expect(tailAction("receipts", {})).toBe("review");
    expect(tailAction("payments", {})).toBe("evidence");
    expect(tailAction("online_payment_events", {})).toBe("upsert");
    expect(tailAction("notification_outbox", {})).toBe("skip");
    expect(tailAction("online_payment_orders", {}, { existsInOne: true })).toBe("skip");
    expect(tailAction("online_payment_orders", {}, { existsInOne: false })).toBe("insert");
    expect(tailAction("whatsapp_reminder_sends", { receipt_id: "r" }, { receiptInOne: () => false })).toBe("defer");
    expect(tailAction("school_notice_sends", {}, {})).toBe("insert");
    expect(tailAction("online_payment_order_lines", { receipt_id: "r" }, { receiptInOne: () => false })).toBe("evidence");
  });

  it("builds a review row with ids and amounts only", () => {
    const row = reviewRow(
      { id: "r1", receipt_number: "SVP20261214-0001", student_id: "s1", payment_date: "2026-12-14", payment_mode: "online", total_amount: 500, client_request_id: "c1", created_at: "2026-12-14T05:00:00Z" },
      { payments: [{ id: "p1", receipt_id: "r1", installment_id: "i1", amount: 500, pending_before_posting: 500, pending_after_posting: 0, notes: "free text" }], captures: [{ id: "k1", receipt_id: "r1", provider_payment_id: "pay_x", amount_paise: 50000, application_status: "applied" }] },
      "vgqyilgstjvgohrsiwkb",
    );
    expect(row.evidence.payments).toEqual([{ id: "p1", installment_id: "i1", amount: 500, pending_before_posting: 500, pending_after_posting: 0 }]);
    expect(row.evidence.captures[0].amount_paise).toBe(50000);
    expect(JSON.stringify(row)).not.toContain("free text");
  });
});

describe("reconcile checks", () => {
  it("receipts: per mode/date, max suffix per prefix/date, distinct numbers", () => {
    const f = receiptFigures([
      { receipt_number: "SVP20261030-0001", payment_mode: "cash", payment_date: "2026-10-30", total_amount: 100 },
      { receipt_number: "SVP20261030-0007", payment_mode: "upi", payment_date: "2026-10-30", total_amount: 50 },
      { receipt_number: "VPS00-2604-00135", payment_mode: "cash", payment_date: "2026-04-01", total_amount: 10 },
    ]);
    expect(f.count).toBe(3);
    expect(f.distinctNumbers).toBe(3);
    expect(f.byModeDate["cash|2026-10-30"]).toEqual({ count: 1, sum: 100 });
    expect(f.maxSuffix).toEqual({ "SVP|20261030": 7 });
  });

  it("online invariant: captured = on receipts + review + waiting, and applied names a receipt", () => {
    const caps = [
      { amount_paise: 100, application_status: "applied", receipt_id: "r1" },
      { amount_paise: 50, application_status: "review_required" },
      { amount_paise: 25, application_status: "pending" },
    ];
    expect(onlineInvariant(caps, new Set(["r1"])).holds).toBe(true);
    expect(onlineInvariant(caps, new Set()).holds).toBe(false);
  });

  it("per-student checksums name the students that differ, real sessions only", () => {
    const a = [{ student_id: "s1", session_label: "2026-27", total_paid: 1 }, { student_id: "t", session_label: "TEST-2026-27", total_paid: 1 }];
    const b = [{ student_id: "s1", session_label: "2026-27", total_paid: 2 }, { student_id: "t", session_label: "TEST-2026-27", total_paid: 9 }];
    expect(checksumMismatches(studentChecksums(a), studentChecksums(b))).toEqual(["s1"]);
    expect(studentChecksums(a, { test: true }).size).toBe(1);
  });
});

describe("rows, env, secrets, storage, auth, extract helpers", () => {
  it("canonical JSON ignores key order; ordered md5 ignores row order", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(canonical({ a: { c: [1, { e: 2, f: 1 }], d: 2 }, b: 1 }));
    expect(orderedMd5([{ id: "2" }, { id: "1" }], ["id"])).toBe(orderedMd5([{ id: "1" }, { id: "2" }], ["id"]));
    expect(pkKey({ a: 1, b: "x" }, ["a", "b"])).toBe('[1,"x"]');
  });

  it("parses env files and args without printing values", () => {
    expect(parseEnvText('# c\nA=1\nB="two"\n\nC=x=y')).toEqual({ A: "1", B: "two", C: "x=y" });
    expect(parseArgs(["--run", "r1", "--apply", "--as-of=2026-10-30"])).toEqual({ _: [], run: "r1", apply: true, "as-of": "2026-10-30" });
  });

  it("seals secrets so a tampered file does not open", () => {
    const key = Buffer.alloc(32, 7);
    const box = seal('{"id":"x"}', key);
    expect(open(box, key).toString()).toBe('{"id":"x"}');
    expect(box.toString("utf8")).not.toContain('"id"');
    box[box.length - 1] ^= 1;
    expect(() => open(box, key)).toThrow();
  });

  it("copies storage objects that are missing or a different size, idempotently", () => {
    const p = storageCopyPlan(
      [{ path: "a", size: 1 }, { path: "b", size: 2 }, { path: "c", size: 3 }],
      [{ path: "a", size: 1 }, { path: "b", size: 9 }],
    );
    expect(p.same).toBe(1);
    expect(p.copy.map((c: { path: string; reason: string }) => `${c.path}:${c.reason}`)).toEqual(["b:size", "c:missing"]);
  });

  it("maps a fees user whose email is a One account onto that account (D-350), never a second auth user", () => {
    const p = planAuthImport(
      [{ id: "u1", email: "A@x.invalid" }, { id: "u2", email: "b@x.invalid" }, { id: "u3", email: "c@x.invalid" }],
      [{ id: "other", email: "a@x.invalid" }, { id: "u2", email: "b@x.invalid" }],
    );
    expect(p).toEqual({ insert: ["u3"], update: ["u2"], clashes: [], remap: [{ sourceId: "u1", targetId: "other" }] });
  });

  it("refuses only an ambiguous email: two fees users claiming one One account", () => {
    const p = planAuthImport(
      [{ id: "u1", email: "a@x.invalid" }, { id: "u9", email: "x@x.invalid" }],
      [{ id: "other", email: "a@x.invalid" }],
      new Map([["u9", "other"]]),
    );
    expect(p.remap).toEqual([{ sourceId: "u1", targetId: "other" }]);
    expect(p.clashes).toEqual(["u9"]);
  });

  it("a recorded mapping wins over the email, so a changed email keeps its account", () => {
    const p = planAuthImport([{ id: "u1", email: "new@x.invalid" }], [{ id: "one", email: "old@x.invalid" }], new Map([["u1", "one"]]));
    expect(p).toEqual({ insert: [], update: [], clashes: [], remap: [{ sourceId: "u1", targetId: "one" }] });
  });

  it("rewrites every reference to a remapped fees user, and nothing else", () => {
    const source = new Map([
      ["users", [{ id: "u1", role: "admin" }, { id: "u3", role: "accountant" }]],
      ["receipts", [{ id: "r1", posted_by: "u1", created_by: "u3", note: "u1 in prose" }]],
    ]);
    const out = remapUserReferences(source, [{ sourceId: "u1", targetId: "one" }]);
    expect(out.get("users")).toEqual([{ id: "one", role: "admin" }, { id: "u3", role: "accountant" }]);
    expect(out.get("receipts")).toEqual([{ id: "r1", posted_by: "one", created_by: "u3", note: "u1 in prose" }]);
    expect(source.get("users")?.[0].id).toBe("u1");
  });

  it("gives a fees user with no One account the One role of the same name, least for anything else", () => {
    for (const role of ["admin", "accountant", "fee_collector", "teacher", "view_only"]) expect(oneRoleForFeeRole(role)).toBe(role);
    expect(oneRoleForFeeRole("read_only_staff")).toBe("view_only");
    expect(oneRoleForFeeRole(undefined)).toBe("view_only");
  });

  it("never writes the public.users row of a user with a staff profile: One derives it (D-350)", () => {
    const meta = { tables: { users: { columns: [col("id"), col("role")], pk: ["id"], uniques: [], triggers: [], sequences: [] } }, fks: [] };
    const p = planLoad({
      meta,
      source: new Map([["users", [{ id: "one", role: "admin" }, { id: "fees-only", role: "accountant" }]]]),
      target: new Map([["users", [{ id: "one", role: "view_only" }, { id: "qa", role: "view_only" }, { id: "stale", role: "admin" }]]]),
      feesRef: "vgqyilgstjvgohrsiwkb",
      derivedUserIds: new Set(["one", "qa"]),
    });
    expect(p.tables.users.insert).toEqual(["fees-only"]);
    expect(p.tables.users.update).toEqual([]);
    expect(p.tables.users.delete).toEqual(["stale"]);
    expect(p.tables.users.counts).toMatchObject({ owned: 1, ownedKept: 1 });
  });

  it("makes a unique short name", () => {
    expect(shortNameFor("Asha Devi Rao", new Set())).toBe("ADR");
    expect(shortNameFor("Asha Devi Rao", new Set(["adr", "ADR2"]))).toBe("ADR3");
    expect(shortNameFor("", new Set())).toBe("FEE");
  });

  it("keeps only the auth users behind public.users, and finds the newest change", () => {
    expect(pickAuthUsers([{ id: "a" }, { id: "b" }], ["b"])).toEqual([{ id: "b" }]);
    expect(newestChange({ t: { count: 1, max: { created_at: "2026-10-30T01:00:00Z", updated_at: "2026-10-30T02:00:00Z" } }, u: { count: 0, max: { created_at: null } } })).toBe("2026-10-30T02:00:00Z");
  });

  it("reads tables and keys from PostgREST's OpenAPI document; views are v_*", () => {
    const doc = {
      definitions: {
        students: { properties: { id: { description: "Note:\nThis is a Primary Key.<pk/>" }, updated_at: {}, created_at: {} } },
        v_workbook_student_financials: { properties: { student_id: { description: "<pk/>" } } },
      },
    };
    const r = relationsFromOpenApi(doc);
    expect(r.tables).toEqual([{ name: "students", columns: ["id", "updated_at", "created_at"], pk: ["id"], changeColumns: ["updated_at", "created_at"] }]);
    expect(r.views.map((v: { name: string }) => v.name)).toEqual(["v_workbook_student_financials"]);
    expect(fingerprintDrift({ a: { count: 1 } }, { a: { count: 2 }, b: { count: 0 } })).toEqual(["a", "b"]);
  });
});

describe("rollback export", () => {
  it("files every kind of One change for re-entry, not only receipts", () => {
    expect(rollbackCategory("receipts", { payment_mode: "discount" }, "INSERT", null)).toBe("write-offs");
    expect(rollbackCategory("receipts", { payment_mode: "online" }, "INSERT", null)).toBe("receipts");
    expect(rollbackCategory("students", {}, "INSERT", null)).toBe("admissions");
    expect(rollbackCategory("students", { left_on: "2026-12-20" }, "UPDATE", { left_on: null })).toBe("leavers");
    expect(rollbackCategory("students", { left_on: null }, "UPDATE", { left_on: null })).toBe("student edits");
    expect(rollbackCategory("student_repayment_plans", {}, "INSERT", null)).toBe("EMI plans");
    expect(rollbackCategory("student_family_members", {}, "INSERT", null)).toBe("family links");
    expect(rollbackCategory("whatsapp_reminder_sends", {}, "INSERT", null)).toBe("reminder sends and notices");
  });

  it("keeps TEST-session changes off the re-entry list", () => {
    const ctx = { testStudents: new Set(["t1"]), testClasses: new Set(["c-test"]) };
    expect(isTestChange({ student_id: "t1" }, ctx)).toBe(true);
    expect(isTestChange({ session_label: "TEST-2026-27" }, ctx)).toBe(true);
    expect(isTestChange({ class_id: "c-test" }, ctx)).toBe(true);
    expect(isTestChange({ student_id: "s1", session_label: "2026-27" }, ctx)).toBe(false);
  });
});

describe("run folders stay out of the repo", () => {
  it("refuses a run id that is not a plain name", async () => {
    const { MIGRATION_HOME, runDir } = await import("../scripts/migrate/lib/env.mjs");
    expect(() => runDir("../escape", { create: false })).toThrow();
    expect(() => runDir("a/b", { create: false })).toThrow();
    expect(runDir("20261030T120000Z", { create: false })).toContain(MIGRATION_HOME);
  });
});
