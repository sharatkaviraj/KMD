import { describe, expect, it } from "vitest";

import { MATVIEW_ORDER_SQL } from "../scripts/migrate/lib/catalog.mjs";
import { planLoad } from "../scripts/migrate/lib/diff.mjs";
import { applyPlan, assertRowPlanReconciled, reconcileImportedRowsThenSettle, refreshAndSetval } from "../scripts/migrate/load-snapshot.mjs";
import { insertRows, upsertEvents } from "../scripts/migrate/tail-sync.mjs";

type Row = Record<string, unknown>;

/**
 * Exercise the write helpers with an injected transaction. A $1::jsonb
 * parameter reaches postgres.js as a JSON value: its JSON serializer must
 * see an array for recordset, or an object for record. A pre-encoded string
 * reproduces the first-table failure reported by the load rehearsal.
 * No database connection or real data is used here.
 */
function transaction(columns: string[] = []) {
  const calls: { query: string; value: unknown }[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      if (query.includes("information_schema.columns")) return columns.map((column_name) => ({ column_name }));
      if (query.includes("pg_class")) return [{ n: 0 }];
      throw new Error(`Unexpected tagged query: ${query}`);
    },
    {
      unsafe: async (query: string, params: unknown[] = []) => {
        if (!query.includes("jsonb_populate_record")) return { count: 0 };
        expect(query).toContain("$1::jsonb");
        expect(params).toHaveLength(1);
        const [value] = params;
        expect(value).not.toBeNull();
        expect(typeof value).toBe("object");
        expect(Array.isArray(value)).toBe(query.includes("jsonb_populate_recordset"));
        // The JSON serializer must preserve nested arrays/objects and scalars.
        expect(JSON.parse(JSON.stringify(value))).toEqual(value);
        calls.push({ query, value });
        if (query.startsWith("select count(*)")) return [{ n: 0 }];
        return { count: Array.isArray(value) ? value.length : 1 };
      },
    },
  );
  return { tx, calls };
}

describe("migration jsonb parameters", () => {
  it("passes arrays through every snapshot write and external-reference check", async () => {
    const rows: Row[] = [
      { id: "inserted", parent_id: "updated", payload: { note: 'quote " and slash \\ and newline\n', amount: "12.50", values: [null, false, 0] } },
      { id: "updated", parent_id: null, payload: { children: [{ id: "synthetic" }] } },
    ];
    const columns = ["id", "parent_id", "payload"];
    const { tx, calls } = transaction();
    const result = await applyPlan(tx, {
      meta: {
        tables: { students: { pk: ["id"], columns: columns.map((name) => ({ name })), triggers: [] } },
        allFks: [{ name: "external_student", parentSchema: "public", parent: "students", parentCols: ["id"], childSchema: "vppsone", child: "student_records", childCols: ["student_id"] }],
      },
      plan: {
        order: ["students"],
        deferred: { students: ["parent_id"] },
        repoint: [{ child: "students", keys: ["updated"], columns: ["parent_id"], nullable: true, notUpdated: false }],
        tables: {
          students: { columns, rows: new Map(rows.map((row) => [row.id, row])), insert: ["inserted"], update: ["updated"], delete: ["deleted"] },
        },
      },
    });

    // Staging, external references, detachment, cycle clearing, deletion,
    // insertion, normal update and deferred update each bind a JSON array.
    expect(calls).toHaveLength(8);
    expect(calls[0].value).toEqual(rows);
    expect(calls.slice(1).map(({ value }) => value)).toEqual([
      [{ id: "deleted" }], [{ id: "updated" }], [{ id: "deleted" }], [{ id: "deleted" }],
      [{ id: "inserted" }], [{ id: "updated" }], [{ id: "inserted" }, { id: "updated" }],
    ]);
    expect(result.counts).toEqual({ students: { deleted: 1, inserted: 1, updated: 1 } });
  });

  it("passes a transformed tail row as an object", async () => {
    const { tx, calls } = transaction(["id", "status", "payload"]);
    const row = { id: "synthetic-order", status: "pending", payload: { amounts: [125, 0], note: '"quoted"' } };

    expect(await insertRows(tx, "online_payment_orders", [row])).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toEqual({ ...row, status: "abandoned" });
    expect(row.status).toBe("pending");
  });

  it("passes a transformed event as an object and keeps the ignored-twin condition", async () => {
    const { tx, calls } = transaction(["id", "provider_event_id", "status", "payload"]);
    const row = { id: "synthetic-event", provider_event_id: "evt_synthetic", status: "pending", payload: { nested: { paid: true }, values: [null] } };

    expect(await upsertEvents(tx, [row])).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toEqual({ ...row, status: "ignored" });
    expect(calls[0].query).toContain("where public.online_payment_events.status = 'ignored'");
    expect(row.status).toBe("pending");
  });
});

describe("load rehearsal sequence handling", () => {
  const meta = {
    tables: {
      synthetic: {
        columns: [{ name: "id", type: "bigint" }, { name: "counter", type: "integer" }],
        sequences: [{ column: "id", sequence: "public.synthetic_id_seq" }, { column: "counter", sequence: "public.synthetic_counter_seq" }],
      },
    },
  };

  it("reads planned next values without setval in rollback-only mode", async () => {
    const floors: unknown[][] = [];
    const tx = {
      unsafe: async (query: string, params: unknown[] = []) => {
        if (query === MATVIEW_ORDER_SQL) return [];
        expect(query).not.toMatch(/setval|nextval|alter\s+sequence/i);
        expect(query).toContain("::text as next_value");
        floors.push(params);
        return [{ next_value: params[0] === 1 ? "99" : "1000000050" }];
      },
    };
    const result = await refreshAndSetval(tx, meta, ["synthetic"], { rollbackOnly: true });
    expect(floors).toEqual([[1_000_000_000], [1]]);
    expect(result.sequencePlan).toEqual([
      { table: "synthetic", column: "id", sequence: "public.synthetic_id_seq", nextValue: "1000000050", applied: false },
      { table: "synthetic", column: "counter", sequence: "public.synthetic_counter_seq", nextValue: "99", applied: false },
    ]);
  });

  it("preserves apply's sequence advancement and bigint floor", async () => {
    const parameters: unknown[][] = [];
    const tx = {
      unsafe: async (query: string, params: unknown[] = []) => {
        if (query === MATVIEW_ORDER_SQL) return [];
        expect(query).toContain("select setval($1::regclass, greatest(");
        expect(query).toContain("$2::bigint), false)");
        parameters.push(params);
        return [];
      },
    };
    const result = await refreshAndSetval(tx, meta, ["synthetic"]);
    expect(parameters).toEqual([["public.synthetic_id_seq", 1_000_000_000], ["public.synthetic_counter_seq", 1]]);
    expect(result.sequencePlan).toEqual([]);
  });
});

describe("in-transaction row-plan reconciliation", () => {
  function plan(target: Row[]) {
    return planLoad({
      meta: { tables: { synthetic: { pk: ["id"], columns: [{ name: "id" }, { name: "amount" }], uniques: [] } }, fks: [] },
      source: new Map([["synthetic", [{ id: "row", amount: 100 }]]]),
      target: new Map([["synthetic", target]]),
    });
  }

  it("accepts an equal row set", () => {
    expect(assertRowPlanReconciled(plan([{ id: "row", amount: 100 }]))).toEqual({
      ok: true, tables: 1, remaining: { insert: 0, update: 0, delete: 0 },
    });
  });

  it.each([
    { rows: [], difference: "synthetic +1 ~0 -0" },
    { rows: [{ id: "row", amount: 99 }], difference: "synthetic +0 ~1 -0" },
    { rows: [{ id: "row", amount: 100 }, { id: "extra", amount: 1 }], difference: "synthetic +0 ~0 -1" },
  ])("refuses residual changes: $difference", ({ rows, difference }) => {
    expect(() => assertRowPlanReconciled(plan(rows))).toThrow(difference);
  });

  it("checks imported rows before staff derivation emits its own audit rows", async () => {
    const user = { id: "synthetic-user", role: "view_only" };
    const audit: Row[] = [];
    const source = new Map<string, Row[]>([["users", [user]], ["audit_logs", []]]);
    const target = new Map<string, Row[]>([["users", [user]], ["audit_logs", audit]]);
    const meta = {
      tables: {
        users: { pk: ["id"], columns: [{ name: "id" }, { name: "role" }], uniques: [] },
        audit_logs: { pk: ["id"], columns: [{ name: "id" }, { name: "table_name" }, { name: "record_id" }], uniques: [] },
      },
      fks: [],
    };
    const readPlan = async () => ({
      plan: planLoad({ meta, source, target, derivedUserIds: new Set([user.id]) }),
      authPlan: { clashes: [] }, externalMissingRefs: [],
    });
    const result = await reconcileImportedRowsThenSettle(readPlan, async () => {
      // public.users' audit_users trigger emits this intentional One row.
      audit.push({ id: "own-audit", table_name: "users", record_id: user.id });
      return { rederived: 1 };
    });
    expect(result.reconciliation.ok).toBe(true);
    expect(result.staff).toEqual({ rederived: 1 });
    expect(audit).toHaveLength(1);
    // A comparison after derivation would wrongly try to delete that audit.
    expect(() => assertRowPlanReconciled(planLoad({ meta, source, target, derivedUserIds: new Set([user.id]) }))).toThrow("audit_logs +0 ~0 -1");
  });

  it("does not derive staff roles when imported rows still differ", async () => {
    let derived = false;
    await expect(reconcileImportedRowsThenSettle(
      async () => ({ plan: plan([{ id: "row", amount: 99 }]), authPlan: { clashes: [] }, externalMissingRefs: [] }),
      async () => { derived = true; },
    )).rejects.toThrow("row-plan reconciliation failed");
    expect(derived).toBe(false);
  });
});
