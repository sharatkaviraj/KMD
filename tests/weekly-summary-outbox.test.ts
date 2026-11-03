import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The weekly summary goes through the staff outbox (go-live Phase F; review of
 * PR #148): the Academics bar's "last sent" reads the outbox as well as the
 * hand-sent rows from before it, and the notice is keyed by the session and
 * the week's Monday so a second press queues nothing. Against a fake client.
 */

const rows = vi.hoisted(() => ({
  outbox: null as { created_at: string } | null,
  template: { id: "tpl-1" } as { id: string } | null,
  handSent: null as { created_at: string } | null,
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const name of ["select", "order", "limit"]) builder[name] = () => builder;
      for (const name of ["eq", "neq"]) {
        builder[name] = (column: string, value: unknown) => {
          rows.filters.push([table, `${name}:${column}`, value]);
          return builder;
        };
      }
      builder.maybeSingle = async () => ({
        data: table === "staff_notices" ? rows.outbox : table === "message_templates" ? rows.template : rows.handSent,
        error: null,
      });
      return builder;
    },
  }),
}));

import { weeklySummaryLastSent } from "@/vx/screens/academics/data";
import { weeklySummaryKey } from "@/vx/screens/academics/domain";

beforeEach(() => {
  rows.outbox = null;
  rows.template = { id: "tpl-1" };
  rows.handSent = null;
  rows.filters = [];
});

describe("the weekly summary's last-sent date", () => {
  it("reads the staff outbox: a summary sent after Phase F moves the date on", async () => {
    rows.handSent = { created_at: "2026-10-20T10:00:00.000Z" };
    rows.outbox = { created_at: "2026-11-02T10:00:00.000Z" };
    expect(await weeklySummaryLastSent("2026-27")).toBe("2026-11-02T10:00:00.000Z");
    expect(rows.filters).toEqual(
      expect.arrayContaining([
        ["staff_notices", "eq:kind", "weekly_summary"],
        ["staff_notices", "eq:session_label", "2026-27"],
        ["staff_notices", "neq:status", "cancelled"],
      ]),
    );
  });

  it("still shows a hand-sent summary from before the outbox, and nothing when neither exists", async () => {
    rows.handSent = { created_at: "2026-10-20T10:00:00.000Z" };
    expect(await weeklySummaryLastSent("2026-27")).toBe("2026-10-20T10:00:00.000Z");
    rows.handSent = null;
    rows.template = null;
    expect(await weeklySummaryLastSent("2026-27")).toBeNull();
  });
});

describe("one summary per week per admin", () => {
  it("keys the notice by session, Monday and admin, so a second press is the same key", () => {
    const first = weeklySummaryKey("2026-27", "2026-11-02", "admin-1");
    expect(first).toBe("weekly:2026-27:2026-11-02:admin-1");
    expect(weeklySummaryKey("2026-27", "2026-11-02", "admin-1")).toBe(first);
    expect(weeklySummaryKey("2026-27", "2026-11-09", "admin-1")).not.toBe(first);
    expect(weeklySummaryKey("TEST-2026-27", "2026-11-02", "admin-1")).not.toBe(first);
  });
});
