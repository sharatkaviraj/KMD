import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyFeeRequest } from "@/modules/fees/domain/write-guard";

/*
 * Linking a third brother or sister on a TEST year (8 Nov 2026) saved the
 * family and then stopped: the 3rd Child step switched off everyone else's
 * row with `in(members)` + `neq(recipient)`, and One's fee-writes guard
 * cannot place a `neq` filter, so it refused the update. Re-activating an
 * existing row by `id` alone was refused the same way. This runs the real
 * step over a real PostgREST client whose fetch asks the guard about every
 * write, so a filter the guard cannot place fails here, not on a phone.
 * Synthetic TEST ids only.
 */

const session = "TEST-2026-27";
const group = "eeeeeeee-0000-4000-8000-000000000001";
const policy = "33333333-3333-4333-8333-333333333333";
const [a, b, c] = ["00000001-0000-4000-8000-000000000001", "00000002-0000-4000-8000-000000000002", "00000003-0000-4000-8000-000000000003"];
const existingRow = "44444444-4444-4444-8444-444444444444";

const seen = vi.hoisted(() => ({ writes: [] as Array<{ method: string; url: string; unscoped: boolean }> }));

function answer(method: string, url: URL, accept: string): unknown {
  const table = url.pathname.split("/").pop();
  if (method !== "GET") return [];
  const rows: Record<string, unknown[]> = {
    student_family_members: [a, b, c].map((student_id) => ({ student_id })),
    conventional_discount_policies: [{
      id: policy, academic_session_label: session, code: "third_child", display_name: "3rd Child Policy",
      calculation_type: "tuition_fixed_amount", fixed_tuition_amount: 6000, percentage: null, is_active: true,
      is_builtin: true, sort_order: 3, updated_at: "2026-11-08T00:00:00Z",
    }],
    students: [a, b, c].map((id, i) => ({
      id, admission_no: `TEST-${i}`, full_name: `TEST Child ${i}`, status: "active", class_id: `class-${i}`,
      class_ref: { id: `class-${i}`, session_label: session, class_name: `Class ${i + 1}`, section: null, stream_name: null, sort_order: i + 1 },
    })),
    fee_settings: [{ class_id: "class-0", tuition_fee_amount: 16000 }],
    // The recipient already has a switched-off automatic row: the update path.
    student_conventional_discount_assignments: [{
      id: existingRow, is_active: false, reason: "old", notes: null, before_tuition_amount: 16000, resulting_tuition_amount: 6000,
      family_group_id: group, is_manual_override: false, manual_override_reason: null,
    }],
  };
  const list = rows[table ?? ""] ?? [];
  return accept.includes("vnd.pgrst.object") ? (list[0] ?? null) : list;
}

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({
  createAdminClient: () =>
    createSupabase("https://test.supabase.co", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          const method = (init?.method ?? "GET").toUpperCase();
          const body = typeof init?.body === "string" ? init.body : null;
          const target = classifyFeeRequest({ method, url: url.href, body });
          if (target.kind === "write") seen.writes.push({ method, url: decodeURIComponent(url.pathname + url.search), unscoped: target.unscoped });
          const headers = new Headers(init?.headers);
          const data = answer(method, url, headers.get("Accept") ?? "");
          return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
        },
      },
    }),
}));

import { applyThirdChildPolicyForFamilyGroup } from "@/modules/fees/data/conventional-discounts";

describe("the 3rd Child step on a TEST year", () => {
  beforeEach(() => {
    seen.writes = [];
  });

  it("gives it to the youngest class and every write it sends is one the fee-writes guard can place", async () => {
    const result = await applyThirdChildPolicyForFamilyGroup(group, { academicSessionLabel: session });
    expect(result).toMatchObject({ recipientStudentId: a, eligibleCount: 3, policyConfigured: true });
    expect(seen.writes.length).toBeGreaterThanOrEqual(4);
    expect(seen.writes.filter((w) => w.unscoped)).toEqual([]);
    // Everyone but the recipient, as a list: never a `neq`.
    const off = seen.writes.find((w) => w.url.includes("student_conventional_discount_assignments") && w.url.includes("policy_id"));
    expect(off?.url).toContain(`student_id=in.(${b},${c})`);
    expect(seen.writes.some((w) => w.url.includes("neq."))).toBe(false);
    // The recipient's existing row is switched back on by its id AND its child.
    const on = seen.writes.find((w) => w.url.includes(`id=eq.${existingRow}`));
    expect(on?.url).toContain(`student_id=eq.${a}`);
  });
});
