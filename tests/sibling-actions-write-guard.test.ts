import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyFeeRequest } from "@/modules/fees/domain/write-guard";

/*
 * Taking the second-last child out of a TEST family (BrowserStack, 8 Nov
 * 2026) said "This family has ended", yet the family stayed on the list with
 * one child: the ported engine deleted the group by its id alone, One's
 * fee-writes guard cannot place that, and the engine never looked at the
 * error. Joining two families sent two more writes of the same kind. This
 * runs the real sibling actions over a real PostgREST client whose fetch asks
 * the guard about every write. Synthetic TEST ids only.
 */

const session = "TEST-2026-27";
const [g1, g2] = ["eeeeeeee-0000-4000-8000-000000000001", "eeeeeeee-0000-4000-8000-000000000002"];
const [a, b] = ["00000001-0000-4000-8000-000000000001", "00000002-0000-4000-8000-000000000002"];

const seen = vi.hoisted(() => ({
  writes: [] as Array<{ method: string; table: string; url: string; unscoped: boolean }>,
  members: [] as Array<Record<string, unknown>>,
}));

function answer(method: string, url: URL, accept: string): unknown {
  const table = url.pathname.split("/").pop() ?? "";
  if (method !== "GET") return [];
  const rows: Record<string, unknown[]> = {
    students: [a, b].map((id, i) => ({
      id, full_name: `TEST Child ${i}`, admission_no: `TEST-${i}`, father_name: "TEST Father", primary_phone: null, secondary_phone: null,
    })),
    student_family_members: seen.members,
    student_family_groups: [
      { id: g1, created_at: "2026-11-01T00:00:00Z", academic_session_label: session },
      { id: g2, created_at: "2026-11-02T00:00:00Z", academic_session_label: session },
    ],
    student_conventional_discount_assignments: [{ academic_session_label: session }],
  };
  const list = rows[table] ?? [];
  return accept.includes("vnd.pgrst.object") ? (list[0] ?? null) : list;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/modules/fees/platform/session", () => ({ requireStaffPermission: async () => ({}) }));
vi.mock("@/platform/auth/test-session-access", () => ({
  assertFamilyVisible: async () => {},
  assertSessionWritable: async () => {},
  assertStudentsVisible: async () => {},
}));
vi.mock("@/modules/fees/data/conventional-discounts", () => ({
  applyThirdChildPolicyForFamilyGroup: async () => null,
  deactivateAutomaticThirdChildAssignments: async () => [],
}));
vi.mock("@/modules/system-sync/domain/finance-sync", () => ({ prepareDuesForStudentsAutomatically: async () => {} }));
vi.mock("@/modules/system-sync/data/financial-view-refresh", () => ({ drainFinancialViewRefresh: async () => {} }));
vi.mock("@/modules/fees/platform/supabase/server", () => ({
  createClient: async () =>
    createSupabase("https://test.supabase.co", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          const method = (init?.method ?? "GET").toUpperCase();
          const body = typeof init?.body === "string" ? init.body : null;
          const target = classifyFeeRequest({ method, url: url.href, body });
          if (target.kind === "write") {
            seen.writes.push({ method, table: url.pathname.split("/").pop() ?? "", url: decodeURIComponent(url.search), unscoped: target.unscoped });
          }
          const data = answer(method, url, new Headers(init?.headers).get("Accept") ?? "");
          return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
        },
      },
    }),
}));

import { linkSiblingsAction, unlinkSiblingAction } from "@/app/(app)/fees/students/sibling-actions";

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) fd.append(key, v);
  return fd;
};

describe("the ported sibling actions on a TEST year", () => {
  beforeEach(() => {
    seen.writes = [];
    seen.members = [];
  });

  it("taking out the second-last child removes the family of one with a write the guard can place", async () => {
    seen.members = [{ family_group_id: g1, student_id: a, academic_session_label: session, sibling_order: 1 }];
    const result = await unlinkSiblingAction({ status: "idle", message: null }, form({ studentId: b, familyGroupId: g1, sessionLabel: session }));
    expect(result).toEqual({ status: "success", message: "Sibling unlinked." });
    expect(seen.writes.filter((w) => w.unscoped)).toEqual([]);
    const groupDelete = seen.writes.find((w) => w.method === "DELETE" && w.table === "student_family_groups");
    expect(groupDelete?.url).toContain(`id=in.(${g1})`);
    expect(groupDelete?.url).toContain(`academic_session_label=in.(${session})`);
  });

  it("a family that keeps two children is not removed", async () => {
    seen.members = [a, "00000003-0000-4000-8000-000000000003"].map((student_id) => ({ family_group_id: g1, student_id, academic_session_label: session, sibling_order: 1 }));
    const result = await unlinkSiblingAction({ status: "idle", message: null }, form({ studentId: b, familyGroupId: g1, sessionLabel: session }));
    expect(result.status).toBe("success");
    expect(seen.writes.some((w) => w.table === "student_family_groups")).toBe(false);
  });

  it("joining two families re-points discounts and removes the absorbed family with writes the guard can place", async () => {
    seen.members = [
      { family_group_id: g1, student_id: a, academic_session_label: session, sibling_order: 1 },
      { family_group_id: g2, student_id: b, academic_session_label: session, sibling_order: 1 },
    ];
    const result = await linkSiblingsAction(
      { status: "idle", message: null, familyGroupId: null },
      form({ studentId: a, sessionLabel: session, siblingStudentIds: [b] }),
    );
    expect(result).toMatchObject({ status: "success", familyGroupId: g1 });
    expect(seen.writes.filter((w) => w.unscoped)).toEqual([]);
    const repoint = seen.writes.find((w) => w.method === "PATCH" && w.table === "student_conventional_discount_assignments");
    expect(repoint?.url).toContain(`family_group_id=in.(${g2})`);
    expect(repoint?.url).toContain(`academic_session_label=in.(${session})`);
    const absorbed = seen.writes.find((w) => w.method === "DELETE" && w.table === "student_family_groups");
    expect(absorbed?.url).toContain(`id=in.(${g2})`);
    expect(absorbed?.url).toContain(`academic_session_label=in.(${session})`);
  });
});
