import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TERMINAL_RULES,
  importTransform,
  isOneOwnedAppSetting,
  reconcilerWouldPickUp,
} from "../scripts/migrate/lib/import-rules.mjs";
import { ONLINE_SWITCH_KEYS } from "@/modules/payments/domain/online/switches";

/**
 * The importer's rules against the reconcilers One now actually runs (go-live
 * Phase E; critique0 #2, #3, #21).
 *
 * `scripts/migrate/lib/import-rules.mjs` was written in Phase A2 against the
 * fees app's reconcilers "as One will port them". They are ported now
 * (`payments/data/online/{service,orders}.ts`), so these read the ported
 * source and hold the two to each other: if a reconciler starts selecting a
 * status the importer still imports, a fees row would be picked up and posted
 * a second time in One.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const service = read("src/modules/payments/data/online/service.ts");
const orders = read("src/modules/payments/data/online/orders.ts");

describe("the ported reconcilers select what RECONCILER_FILTERS says they do", () => {
  it("orders: pending is failed, open/superseded/paid are asked about", () => {
    expect(orders).toContain('.eq("status", "pending")');
    expect(orders).toContain('.in("status", ["open", "superseded", "paid"])');
    expect(reconcilerWouldPickUp("online_payment_orders", { status: "pending" })).toBe(true);
    for (const status of ["open", "superseded", "paid"]) {
      expect(reconcilerWouldPickUp("online_payment_orders", { status })).toBe(true);
    }
  });

  it("intents: the link pass's or-filter", () => {
    expect(service).toContain(
      '"status.in.(link_pending,link_created),and(status.in.(superseded,expired,cancelled,failed),provider_cancelled_at.is.null)"',
    );
    expect(reconcilerWouldPickUp("online_payment_intents", { status: "link_created" })).toBe(true);
    expect(reconcilerWouldPickUp("online_payment_intents", { status: "expired", provider_cancelled_at: null })).toBe(true);
    expect(reconcilerWouldPickUp("online_payment_intents", { status: "expired", provider_cancelled_at: "2026-10-30T00:00:00Z" })).toBe(false);
  });

  it("the inbox, pending captures and the receipt outbox", () => {
    expect(service).toContain('.in("status", ["pending", "failed"])');
    expect(service).toContain('.eq("application_status", "pending")');
    expect(service).toContain('supabase.rpc("notification_outbox_claim"');
    expect(reconcilerWouldPickUp("online_payment_events", { status: "failed" })).toBe(true);
    expect(reconcilerWouldPickUp("online_payment_captures", { application_status: "pending" })).toBe(true);
    expect(reconcilerWouldPickUp("notification_outbox", { status: "queued" })).toBe(true);
  });

  it("and, as a second fence, never touch a fees app reference at all", () => {
    expect(orders.match(/\.not\("provider_receipt", "like", `\$\{FEES_APP_REFERENCE_PREFIX\}%`\)/g)).toHaveLength(2);
    expect(service).toContain('.not("provider_reference_id", "like", `${FEES_APP_REFERENCE_PREFIX}%`)');
  });
});

describe("every non-terminal online row is made terminal or left out on import", () => {
  const STATES: Record<string, { column: string; values: string[] }> = {
    online_payment_orders: { column: "status", values: ["pending", "open", "paid", "accounted", "review_required", "superseded", "abandoned", "failed"] },
    online_payment_intents: {
      column: "status",
      values: ["link_pending", "link_created", "paid", "accounted", "review_required", "superseded", "cancelled", "expired", "failed"],
    },
    online_payment_events: { column: "status", values: ["pending", "processed", "ignored", "failed"] },
    online_payment_captures: { column: "application_status", values: ["pending", "applied", "review_required"] },
    notification_outbox: {
      column: "status",
      values: ["queued", "processing", "provider_accepted", "delivered", "failed", "suppressed", "uncertain"],
    },
  };

  for (const [table, { column, values }] of Object.entries(STATES)) {
    it(`${table}: no imported row is one a reconciler would take`, () => {
      expect(TERMINAL_RULES[table as keyof typeof TERMINAL_RULES]).toBeDefined();
      for (const value of values) {
        const source = { id: "x", [column]: value, provider_cancelled_at: null, created_at: "2026-12-13T00:00:00Z" };
        const { row } = importTransform(table, source);
        if (row) expect(reconcilerWouldPickUp(table, row), `${table} ${value}`).toBe(false);
      }
    });
  }
});

describe("the seven switches are One's own", () => {
  it("the mirror never copies them from the fees app", () => {
    for (const key of ONLINE_SWITCH_KEYS) expect(isOneOwnedAppSetting(key), key).toBe(true);
    expect(isOneOwnedAppSetting("online_payment_order_max_rupees")).toBe(true);
    expect(isOneOwnedAppSetting("receipt_suffix_floor")).toBe(true);
  });

  it("are exactly seven, and leave out the number and the staff-alert switch", () => {
    expect(ONLINE_SWITCH_KEYS).toHaveLength(7);
    expect(ONLINE_SWITCH_KEYS).not.toContain("online_payment_order_max_rupees");
    expect(ONLINE_SWITCH_KEYS).not.toContain("online_payment_staff_whatsapp_enabled");
    const actions = read("src/app/(app)/fees/payments/online/actions.ts");
    expect(actions).toContain("ONLINE_SWITCH_KEYS");
    expect(actions).not.toMatch(/new Set\(\[\s*"online_payment_/);
  });
});
