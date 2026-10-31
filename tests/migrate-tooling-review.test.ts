import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { compareWithMcp, sessionYearSplit } from "../scripts/migrate/lib/control-totals.mjs";
import { findRepointedChildren, planLoad } from "../scripts/migrate/lib/diff.mjs";
import { latestRunId } from "../scripts/migrate/lib/env.mjs";
import {
  classifyTestRows,
  importTransform,
  NOT_MIGRATED,
  RECONCILER_FILTERS,
  reconcilerWouldPickUp,
  SKIP_TABLES,
  unmigratedSourceData,
} from "../scripts/migrate/lib/import-rules.mjs";
import { eventTwinViolations, oneMatviewFresh } from "../scripts/migrate/lib/reconcile-checks.mjs";
import { isBucketMissing } from "../scripts/migrate/lib/storage-list.mjs";
import { planTailInserts, reviewRow, TAIL_INSERT_ORDER, tailAction } from "../scripts/migrate/lib/tail.mjs";
import { matviewFreshness } from "../scripts/migrate/extract-live.mjs";
import { authCompleteness, blockers, countMismatches, ONE_IDENTITY_FLOOR } from "../scripts/migrate/load-snapshot.mjs";
import { ROLLBACK_PROCEDURES, rollbackCategory, rollbackProcedure } from "../scripts/migrate/rollback-export.mjs";

/**
 * The A2 review fixes: the pure rules behind each. Synthetic rows only — no
 * real student, phone or receipt (rule 6).
 */

type Row = Record<string, unknown>;

const col = (name: string) => ({ name, type: "text", notNull: false, generated: false, identity: false });
const table = (columns: string[], pk = ["id"]) => ({ columns: columns.map(col), pk, uniques: [], triggers: [], sequences: [] });

/* ------------------------------------------------ terminal-state import */

describe("imported online rows match none of the reconcilers' actual filters", () => {
  // Every value each table's CHECK allows (wtgx, 30 Oct).
  const STATUSES: Record<string, { column: string; values: string[] }> = {
    online_payment_orders: { column: "status", values: ["pending", "open", "paid", "accounted", "review_required", "superseded", "abandoned", "failed"] },
    online_payment_intents: { column: "status", values: ["link_pending", "link_created", "paid", "accounted", "review_required", "superseded", "cancelled", "expired", "failed"] },
    online_payment_events: { column: "status", values: ["pending", "processed", "failed", "ignored"] },
    online_payment_captures: { column: "application_status", values: ["pending", "review_required", "applied"] },
    notification_outbox: { column: "status", values: ["queued", "processing", "failed", "provider_accepted", "delivered", "suppressed", "uncertain"] },
  };

  for (const [name, { column, values }] of Object.entries(STATUSES)) {
    it(`${name}: no imported row is picked up`, () => {
      expect(RECONCILER_FILTERS[name]).toBeDefined();
      for (const value of values) {
        // created "now": the 24-hour window of reconcileOpenOrders is open.
        const source = { id: "x", [column]: value, provider_cancelled_at: null, created_at: "2026-10-30T10:00:00Z", updated_at: "2026-10-30T10:05:00Z" };
        const { row, action } = importTransform(name, source);
        if (action === "dropped") continue;
        expect(reconcilerWouldPickUp(name, row), `${name} ${value}`).toBe(false);
      }
    });
  }

  it("staff_payment_alerts: no imported alert is claimable, whatever its two statuses and attempts", () => {
    // Every pair the table's CHECKs allow (fees 20261030170000), and an
    // alert created "now", inside the claim's two-day window.
    const push = ["queued", "sent", "no_devices", "failed"];
    const whatsapp = ["queued", "sent", "partial", "failed", "off", "not_configured"];
    for (const p of push) {
      for (const w of whatsapp) {
        for (const attempts of [0, 4, 5]) {
          const source = { id: "x", push_status: p, whatsapp_status: w, whatsapp_attempts: attempts, locked_until: "2026-10-31T00:00:00Z", created_at: "2026-10-31T00:00:00Z" };
          const { row, action } = importTransform("staff_payment_alerts", source);
          expect(action, `${p}/${w}`).not.toBe("dropped");
          expect(reconcilerWouldPickUp("staff_payment_alerts", row), `${p}/${w}/${attempts}`).toBe(false);
          if (action === "rewritten") expect(row?.locked_until).toBeNull();
        }
      }
    }
    const done = { push_status: "sent", whatsapp_status: "sent", locked_until: null };
    expect(importTransform("staff_payment_alerts", done)).toEqual({ row: done, action: "keep" });
    expect(importTransform("staff_payment_alerts", { push_status: "sent", whatsapp_status: "partial" }).row).toEqual({
      push_status: "sent",
      whatsapp_status: "off",
    });
  });

  it("never carries the fees app's push subscriptions (its own VAPID key)", () => {
    expect(SKIP_TABLES.has("staff_push_subscriptions")).toBe(true);
  });

  it("a superseded order is rewritten (reconcileOpenOrders scans open/superseded/paid)", () => {
    expect(importTransform("online_payment_orders", { status: "superseded" }).row?.status).toBe("abandoned");
  });

  it("closes a non-accounted intent for the link reconciler, deterministically", () => {
    const expired = importTransform("online_payment_intents", { status: "expired", provider_cancelled_at: null, updated_at: "2026-10-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" });
    expect(expired).toEqual({ row: { status: "expired", provider_cancelled_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" }, action: "rewritten" });
    // Same input, same output: reload and reconcile agree.
    expect(importTransform("online_payment_intents", { status: "expired", provider_cancelled_at: null, updated_at: "2026-10-01T00:00:00Z" })).toEqual(
      importTransform("online_payment_intents", { status: "expired", provider_cancelled_at: null, updated_at: "2026-10-01T00:00:00Z" }),
    );
    const accounted = { status: "accounted", provider_cancelled_at: null };
    expect(importTransform("online_payment_intents", accounted)).toEqual({ row: accounted, action: "keep" });
    const already = { status: "cancelled", provider_cancelled_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-03T00:00:00Z" };
    expect(importTransform("online_payment_intents", already)).toEqual({ row: already, action: "keep" });
  });
});

/* ---------------------------------------------- live data One lacks */

describe("live tables and columns One has no place for", () => {
  const meta = { tables: { students: table(["id", "full_name"]) }, fks: [] };

  it("refuses a table with rows or a column One lacks, unless allow-listed", () => {
    const manifest = [
      { name: "students", rowCount: 5, columns: ["id", "full_name", "new_live_column"] },
      { name: "staff_payment_alerts", rowCount: 2, columns: ["id"] },
      { name: "staff_profiles", rowCount: 0, columns: ["id"] },
      { name: "feature_flags", rowCount: 4, columns: ["id"] },
      { name: "backup_runs", rowCount: 9, columns: ["id"] },
    ];
    expect(unmigratedSourceData(manifest, meta)).toEqual({
      tables: [{ table: "staff_payment_alerts", rows: 2 }],
      columns: [{ table: "students", columns: ["new_live_column"] }],
    });
    expect(Object.keys(NOT_MIGRATED).sort()).toEqual(["feature_flags", "job_runs"]);
  });

  it("stops --apply on it", () => {
    const empty = { orphans: [], uniqueConflicts: [], repoint: [] };
    const auth = { clashes: [] };
    expect(blockers({ plan: empty, authPlan: auth, externalMissingRefs: [] })).toEqual([]);
    const stop = blockers({ plan: empty, authPlan: auth, externalMissingRefs: [], unmigrated: { tables: [{ table: "t", rows: 1 }], columns: [{ table: "u", columns: ["c"] }] } });
    expect(stop.join(" ")).toMatch(/live table\(s\) with rows/);
    expect(stop.join(" ")).toMatch(/columns One lacks/);
  });
});

/* -------------------------------------------- TEST rows without an FK */

describe("TEST classification reaches the online tables that have no foreign key", () => {
  it("marks events by payment / link id and audit rows by intent / capture / event id", () => {
    const meta = {
      tables: {
        classes: table(["id", "session_label"]),
        students: table(["id", "class_id"]),
        online_payment_intents: table(["id", "student_id", "provider_link_id"]),
        online_payment_captures: table(["id", "intent_id", "provider_payment_id", "provider_link_id"]),
        online_payment_events: table(["id", "provider_payment_id", "provider_link_id"]),
        online_payment_audit: table(["id", "intent_id", "capture_id", "event_id"]),
      },
      fks: [
        { name: "s_c", child: "students", childCols: ["class_id"], parentSchema: "public", parent: "classes", parentCols: ["id"], nullable: false },
        { name: "i_s", child: "online_payment_intents", childCols: ["student_id"], parentSchema: "public", parent: "students", parentCols: ["id"], nullable: false },
        { name: "k_i", child: "online_payment_captures", childCols: ["intent_id"], parentSchema: "public", parent: "online_payment_intents", parentCols: ["id"], nullable: true },
      ],
    };
    const rows = new Map<string, Row[]>([
      ["classes", [{ id: "ct", session_label: "TEST-2026-27" }, { id: "cr", session_label: "2026-27" }]],
      ["students", [{ id: "st", class_id: "ct" }, { id: "sr", class_id: "cr" }]],
      ["online_payment_intents", [{ id: "it", student_id: "st", provider_link_id: "plink_t" }, { id: "ir", student_id: "sr", provider_link_id: "plink_r" }]],
      ["online_payment_captures", [{ id: "kt", intent_id: "it", provider_payment_id: "pay_t", provider_link_id: "plink_t" }, { id: "kr", intent_id: "ir", provider_payment_id: "pay_r", provider_link_id: "plink_r" }]],
      [
        "online_payment_events",
        [
          { id: "e1", provider_payment_id: "pay_t", provider_link_id: null },
          { id: "e2", provider_payment_id: null, provider_link_id: "plink_t" },
          { id: "e3", provider_payment_id: "pay_r", provider_link_id: "plink_r" },
        ],
      ],
      [
        "online_payment_audit",
        [
          { id: 1, intent_id: "it", capture_id: null, event_id: null },
          { id: 2, intent_id: null, capture_id: null, event_id: "e2" },
          { id: 3, intent_id: "ir", capture_id: "kr", event_id: "e3" },
        ],
      ],
    ]);
    const test = classifyTestRows(rows, meta);
    expect([...(test.get("online_payment_events") ?? [])].sort()).toEqual(["e1", "e2"]);
    expect([...(test.get("online_payment_audit") ?? [])].sort()).toEqual(["1", "2"]);
  });
});

/* --------------------------------------------------- re-pointed children */

describe("a row re-pointed away from a deleted parent", () => {
  const meta = (nullable: boolean, onDelete = "c") => ({
    tables: { students: table(["id", "name"]), plan_items: table(["id", "student_id", "amount"]) },
    fks: [{ name: "plan_items_student_id_fkey", child: "plan_items", childCols: ["student_id"], parentSchema: "public", parent: "students", parentCols: ["id"], onDelete, nullable }],
  });
  // Live merged P into P2: P is gone, the item now points at P2.
  const source = new Map<string, Row[]>([
    ["students", [{ id: "p2", name: "kept" }]],
    ["plan_items", [{ id: "x", student_id: "p2", amount: 5 }]],
  ]);
  const target = new Map<string, Row[]>([
    ["students", [{ id: "p", name: "merged away" }, { id: "p2", name: "kept" }]],
    ["plan_items", [{ id: "x", student_id: "p", amount: 5 }]],
  ]);

  it("is found, so the loader detaches it before the cascade", () => {
    const p = planLoad({ meta: meta(true), source, target, feesRef: "vgqyilgstjvgohrsiwkb" });
    expect(p.tables.students.delete).toEqual(["p"]); // not blocked: the item's final parent is p2
    expect(p.tables.plan_items.update).toEqual(["x"]);
    expect(p.repoint).toEqual([{ constraint: "plan_items_student_id_fkey", child: "plan_items", columns: ["student_id"], nullable: true, onDelete: "c", keys: ["x"], notUpdated: 0 }]);
    expect(blockers({ plan: p, authPlan: { clashes: [] }, externalMissingRefs: [] })).toEqual([]);
  });

  it("refuses when the FK cannot be nulled first", () => {
    const p = planLoad({ meta: meta(false), source, target, feesRef: "vgqyilgstjvgohrsiwkb" });
    expect(p.repoint[0].nullable).toBe(false);
    expect(blockers({ plan: p, authPlan: { clashes: [] }, externalMissingRefs: [] }).join(" ")).toMatch(/re-pointed rows/);
  });

  it("ignores a child that is deleted along with its parent", () => {
    const tables = { students: { delete: ["p"] }, plan_items: { delete: ["x"], update: [] } };
    expect(findRepointedChildren({ meta: meta(true), tables, targetRows: target })).toEqual([]);
  });
});

describe("written counts must equal the plan", () => {
  const plan = { tables: { a: { insert: ["1", "2"], update: ["3"], delete: ["4"] }, b: { insert: [], update: ["5"], delete: [] } } };

  it("names every table that wrote fewer or more rows than planned", () => {
    expect(countMismatches(plan, { a: { inserted: 2, updated: 1, deleted: 1 }, b: { inserted: 0, updated: 1, deleted: 0 } })).toEqual([]);
    // A cascade took row 3 before its update ran.
    expect(countMismatches(plan, { a: { inserted: 2, updated: 0, deleted: 1 }, b: { inserted: 0, updated: 1, deleted: 0 } })).toEqual(["a updated 0 of 1"]);
    // A table not written at all counts as zero.
    expect(countMismatches(plan, { a: { inserted: 2, updated: 1, deleted: 1 } })).toEqual(["b updated 0 of 1"]);
    // Updated null: only deferred columns changed (checked in the second pass).
    expect(countMismatches(plan, { a: { inserted: 2, updated: null, deleted: 1 }, b: { inserted: 0, updated: 1, deleted: 0 } })).toEqual([]);
  });

  it("keeps One's identity values out of live's range", () => {
    expect(ONE_IDENTITY_FLOOR).toBeGreaterThanOrEqual(1_000_000_000);
  });
});

describe("auth rows must carry identities", () => {
  it("refuses the 30 Oct shape: users sealed without identities", () => {
    expect(authCompleteness({ auth: { users: 10, identities: 0 } }, [{ id: "u", identities: [] }]).problems).toHaveLength(2);
    expect(authCompleteness({ auth: { users: 1, identities: 1 } }, [{ id: "u", identities: [{ id: "i" }] }]).problems).toEqual([]);
    expect(authCompleteness({ auth: { users: 1, identities: 1 } }, []).problems.join(" ")).toMatch(/missing/);
    const stop = blockers({ plan: { orphans: [], uniqueConflicts: [] }, authPlan: { clashes: [] }, externalMissingRefs: [], authAudit: { problems: ["x"] } });
    expect(stop).toEqual(["auth: x; extract again"]);
  });
});

/* ----------------------------------------------------------- the tail */

describe("tail-sync inserts parents first and defers what has no parent", () => {
  const fks = [
    { name: "sends_run", childSchema: "public", child: "whatsapp_reminder_sends", childCols: ["run_id"], parentSchema: "public", parent: "whatsapp_campaign_runs", parentCols: ["id"] },
    { name: "sends_student", childSchema: "public", child: "whatsapp_reminder_sends", childCols: ["student_id"], parentSchema: "public", parent: "students", parentCols: ["id"] },
    { name: "sends_receipt", childSchema: "public", child: "whatsapp_reminder_sends", childCols: ["receipt_id"], parentSchema: "public", parent: "receipts", parentCols: ["id"] },
    { name: "orders_send", childSchema: "public", child: "online_payment_orders", childCols: ["send_id"], parentSchema: "public", parent: "whatsapp_reminder_sends", parentCols: ["id"] },
    { name: "intents_send", childSchema: "public", child: "online_payment_intents", childCols: ["send_id"], parentSchema: "public", parent: "whatsapp_reminder_sends", parentCols: ["id"] },
    { name: "intents_receipt", childSchema: "public", child: "online_payment_intents", childCols: ["receipt_id"], parentSchema: "public", parent: "receipts", parentCols: ["id"] },
    { name: "intents_student", childSchema: "public", child: "online_payment_intents", childCols: ["student_id"], parentSchema: "public", parent: "students", parentCols: ["id"] },
    { name: "lines_order", childSchema: "public", child: "online_payment_order_lines", childCols: ["order_id"], parentSchema: "public", parent: "online_payment_orders", parentCols: ["id"] },
  ];
  const inOne: Record<string, Set<string>> = { students: new Set(["s-old"]), receipts: new Set(["r-one"]) };
  const parentExists = (_schema: string, t: string, _c: string, v: string) => inOne[t]?.has(v) ?? false;

  it("a new run, a send on it, an order on that send, and an accounted intent on a fees receipt", () => {
    const receiptInOne = (id: string) => inOne.receipts.has(id);
    const intent = { id: "i1", send_id: "w1", student_id: "s-old", receipt_id: "r-fees", status: "accounted" };
    // The accounted intent names the fees receipt sent to review: evidence, never inserted.
    expect(tailAction("online_payment_intents", intent, { receiptInOne })).toBe("evidence");
    expect(tailAction("online_payment_intents", { ...intent, receipt_id: null }, { receiptInOne })).toBe("insert");
    expect(tailAction("whatsapp_campaign_runs", { id: "run1" })).toBe("insert");

    const candidates = {
      // Given in the WRONG order on purpose: the plan orders them.
      online_payment_order_lines: [{ id: "l1", order_id: "o1" }],
      online_payment_orders: [{ id: "o1", send_id: "w1" }, { id: "o2", send_id: "w-new-student" }],
      whatsapp_reminder_sends: [
        { id: "w1", run_id: "run1", student_id: "s-old", receipt_id: null },
        { id: "w-new-student", run_id: "run1", student_id: "s-admitted-in-fees", receipt_id: null },
      ],
      whatsapp_campaign_runs: [{ id: "run1" }],
      online_payment_intents: [{ ...intent, receipt_id: null, id: "i2" }],
    };
    const { insert, defer } = planTailInserts(candidates, { fks, parentExists });
    const order = TAIL_INSERT_ORDER.filter((t) => insert[t]);
    expect(order).toEqual(["whatsapp_campaign_runs", "whatsapp_reminder_sends", "online_payment_orders", "online_payment_intents", "online_payment_order_lines"]);
    expect(insert.whatsapp_reminder_sends.map((r: Row) => r.id)).toEqual(["w1"]);
    expect(insert.online_payment_orders.map((r: Row) => r.id)).toEqual(["o1"]);
    expect(defer.whatsapp_reminder_sends[0].missing).toEqual(["student_id -> public.students"]);
    // An order on a deferred send waits too.
    expect(defer.online_payment_orders[0]).toMatchObject({ row: { id: "o2" }, missing: ["send_id -> public.whatsapp_reminder_sends"] });
  });

  it("carries accounted intents as review evidence", () => {
    const row = reviewRow({ id: "r-fees", receipt_number: "SVP20261214-0001", student_id: "s", payment_date: "2026-12-14", payment_mode: "online", total_amount: 5 }, { intents: [{ id: "i1", receipt_id: "r-fees", status: "accounted", amount_rupees: 5, provider_link_id: "plink_x" }] }, "vgqyilgstjvgohrsiwkb");
    expect(row.evidence.intents).toEqual([{ id: "i1", status: "accounted", amount_rupees: 5, provider_link_id: "plink_x" }]);
  });
});

describe("event twins (critique1 A7)", () => {
  const fees = [
    { provider_event_id: "evt1", status: "processed", provider_payment_id: "pay1", received_at: "2026-11-02T10:00:00Z" },
    { provider_event_id: "evt2", status: "processed", provider_payment_id: "pay2", received_at: "2026-11-02T10:00:00Z" },
    { provider_event_id: "evt3", status: "processed", provider_payment_id: "pay3", received_at: "2026-11-02T10:00:00Z" },
    { provider_event_id: "evt4", status: "processed", provider_payment_id: "pay4", received_at: "2026-11-02T10:00:00Z" },
    { provider_event_id: "evt5", status: "processed", provider_payment_id: "pay5", received_at: "2026-10-01T10:00:00Z" },
    { provider_event_id: "evt6", status: "ignored", provider_payment_id: "pay6", received_at: "2026-11-02T10:00:00Z" },
  ];
  const one = [
    { provider_event_id: "evt1", status: "pending" }, // One's payment in flight: fine
    { provider_event_id: "evt2", status: "ignored" }, // captured in One: fine
    { provider_event_id: "evt3", status: "ignored" }, // in the review queue: fine
    { provider_event_id: "evt4", status: "ignored" }, // nowhere: violation
  ];

  it("fails a fees-processed payment that One ignored and holds nowhere", () => {
    const out = eventTwinViolations({
      feesEvents: fees,
      oneEvents: one,
      oneCaptures: [{ provider_payment_id: "pay2" }],
      reviewRows: [{ evidence: { captures: [{ provider_payment_id: "pay3" }] } }],
      since: "2026-10-30T00:00:00Z",
    });
    expect(out).toEqual([{ providerEventId: "evt4", oneTwin: "ignored" }]);
  });
});

/* -------------------------------------------- tail-sync event upsert SQL */

describe("tail-sync never overwrites One's own event rows", () => {
  it("updates a twin only where One's row is 'ignored'", () => {
    const text = readFileSync(path.join(__dirname, "..", "scripts", "migrate", "tail-sync.mjs"), "utf8");
    expect(text).toMatch(/on conflict \(provider_event_id\) do update set[\s\S]{0,400}where public\.online_payment_events\.status = 'ignored'/);
  });
});

/* -------------------------------------------------- matview freshness */

describe("matviews must be as new as the data", () => {
  const fingerprint = { receipts: { count: 1, max: { created_at: "2026-10-30T11:00:00Z" } } };

  it("the extract notices a pending or late refresh", () => {
    expect(matviewFreshness([{ pending: false, last_refreshed_at: "2026-10-30T11:05:00Z" }], fingerprint).ok).toBe(true);
    expect(matviewFreshness([{ pending: true, last_refreshed_at: "2026-10-30T11:05:00Z" }], fingerprint).reason).toMatch(/pending/);
    expect(matviewFreshness([{ pending: false, last_refreshed_at: "2026-10-30T10:00:00Z" }], fingerprint).reason).toMatch(/after the last refresh/);
    expect(matviewFreshness([], fingerprint).ok).toBe(false);
  });

  it("reconcile needs One's refreshed on the as-of day (IST)", () => {
    expect(oneMatviewFresh([{ pending: false, last_refreshed_at: "2026-10-30T20:00:00Z" }], "2026-10-31").ok).toBe(true); // 01:30 IST on the 31st
    expect(oneMatviewFresh([{ pending: false, last_refreshed_at: "2026-10-30T11:28:00Z" }], "2026-10-31").ok).toBe(false);
    expect(oneMatviewFresh([{ pending: true, last_refreshed_at: "2026-10-31T01:00:00Z" }], "2026-10-31").ok).toBe(false);
    expect(oneMatviewFresh([], "2026-10-31").ok).toBe(false);
  });
});

/* ---------------------------------------------------------- year split */

describe("the MCP's yearSplit (get_dashboard_fee_split)", () => {
  const inputs = {
    classes: [{ id: "c1", status: "active" }, { id: "c-old", status: "archived" }],
    students: [{ id: "s1", status: "active" }, { id: "s2", status: "left" }, { id: "s3", status: "left" }],
    receipts: [{ id: "r1", payment_mode: "cash" }, { id: "rw", payment_mode: "discount" }],
    payments: [{ student_id: "s2", receipt_id: "r1" }, { student_id: "s3", receipt_id: "rw" }],
    balances: [
      { session_label: "2026-27", student_id: "s1", class_id: "c1", is_carry_forward: false, base_charge: 1000, applied_amount: 1200, pending_amount: 0, late_fee_pending: 50 },
      { session_label: "2026-27", student_id: "s1", class_id: "c1", is_carry_forward: true, base_charge: 300, applied_amount: 100, pending_amount: 200, late_fee_pending: 99 },
      { session_label: "2026-27", student_id: "s2", class_id: "c1", is_carry_forward: false, base_charge: 500, applied_amount: -10, pending_amount: 500, late_fee_pending: -5 },
      // Left and only a write-off: not collectable.
      { session_label: "2026-27", student_id: "s3", class_id: "c1", is_carry_forward: false, base_charge: 700, applied_amount: 0, pending_amount: 700, late_fee_pending: 0 },
      // Archived class: out.
      { session_label: "2026-27", student_id: "s1", class_id: "c-old", is_carry_forward: false, base_charge: 9999, applied_amount: 0, pending_amount: 9999, late_fee_pending: 0 },
      { session_label: "TEST-2026-27", student_id: "s1", class_id: "c1", is_carry_forward: false, base_charge: 1, applied_amount: 0, pending_amount: 1, late_fee_pending: 0 },
    ],
  };

  it("splits current from carry-forward on is_carry_forward, money scope", () => {
    const split = sessionYearSplit(inputs, "2026-27");
    expect(split).toEqual({
      currentYear: { expected: 1500, collected: 1000, pending: 500 },
      previousYear: { originalBalance: 300, collected: 100, pending: 200 },
      lateFeePending: 50,
    });
  });

  it("is compared with the MCP field by field", () => {
    const ours = { headcount: { studentsOnRoll: 1 }, money: {}, yearSplit: sessionYearSplit(inputs, "2026-27") };
    const theirs = { headcount: { studentsOnRoll: 1 }, money: {}, yearSplit: { currentYear: { expected: 1500, collected: 1000, pending: 500 }, previousYear: { originalBalance: 300, collected: 100, pending: 201, note: "x" }, lateFeePending: 50 } };
    expect(compareWithMcp(ours, theirs)).toEqual([{ field: "yearSplit.previousYear.pending", ours: 200, theirs: 201 }]);
    expect(compareWithMcp({ ...ours, yearSplit: undefined }, theirs)[0].field).toBe("yearSplit");
  });
});

/* -------------------------------------------------------- latest run */

describe("the latest run is the newest complete extract, never a name sort", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "vppsone-runs-"));
  afterAll(() => rmSync(home, { recursive: true, force: true }));
  const put = (name: string, manifest: Row) => {
    mkdirSync(path.join(home, name), { recursive: true });
    writeFileSync(path.join(home, name, "manifest.json"), JSON.stringify(manifest));
  };

  it("picks by finishedAt and skips --tables subsets", () => {
    put("rehearsal-1", { finishedAt: "2026-10-29T10:00:00Z" });
    put("20261030T120000Z", { finishedAt: "2026-10-30T12:00:00Z" });
    put("zz-subset", { finishedAt: "2026-10-31T12:00:00Z", subset: ["students"] });
    mkdirSync(path.join(home, "zzz-no-manifest"));
    expect(latestRunId(home)).toBe("20261030T120000Z");
    expect(latestRunId(path.join(home, "missing"))).toBeNull();
  });
});

/* --------------------------------------------------------- the rest */

describe("storage-copy treats only a missing bucket as empty", () => {
  it("knows the bucket-not-found error", () => {
    expect(isBucketMissing(new Error("list /: Bucket not found"))).toBe(true);
    expect(isBucketMissing(new Error("list /: fetch failed"))).toBe(false);
    expect(isBucketMissing(new Error("list /: JWT expired"))).toBe(false);
  });
});

describe("rollback re-entry", () => {
  it("every category has a procedure, and the runbook has every procedure", () => {
    const runbook = readFileSync(path.join(__dirname, "..", "docs", "cutover", "ROLLBACK-REENTRY.md"), "utf8");
    for (const id of new Set(Object.values(ROLLBACK_PROCEDURES))) expect(runbook, id).toContain(`### ${id} `);
    const tables = ["receipts", "payments", "student_late_fee_waivers", "receipt_adjustments", "refund_requests", "student_family_groups", "student_fee_overrides", "students", "defaulter_contacts", "whatsapp_reminder_sends", "student_repayment_plans", "online_payment_captures", "x_unknown"];
    for (const t of tables) {
      const category = rollbackCategory(t, { payment_mode: "cash" }, "INSERT", null);
      expect(rollbackProcedure(category), `${t} -> ${category}`).toMatch(/^R\d+$/);
      expect(ROLLBACK_PROCEDURES[category], category).toBeDefined();
    }
  });
});

describe("the tail review queue's grants", () => {
  it("service_role may select, insert and update — never delete or truncate", () => {
    const dir = path.join(__dirname, "..", "supabase", "migrations");
    const create = readFileSync(path.join(dir, "20261030132121_tail_receipts_review.sql"), "utf8");
    const revoke = readFileSync(path.join(dir, "20261030145719_tail_receipts_review_grants.sql"), "utf8");
    expect(create).toMatch(/grant select, insert, update on vppsone\.tail_receipts_review to service_role;/);
    expect(revoke).toMatch(/^revoke delete, truncate, references, trigger on vppsone\.tail_receipts_review from service_role;$/m);
  });
});
