import { beforeEach, expect, it, vi } from "vitest";

/*
 * perf fix 10: one failed `my_permissions` read under database load turned a
 * slow moment into an error page. It now gets one quick second try; a second
 * failure still refuses, because a guessed permission set could restore a
 * grant an admin removed.
 */

const rpc = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/platform/env", () => ({ hasRequiredEnvVars: true }));
vi.mock("@/platform/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-1", email: "qa@example.invalid" } }, error: null }) },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "staff-1", display_name: "QA Teacher", short_name: "QT", role: "teacher", is_teaching: true, is_active: true, preferred_language: "hi", preferred_start: null },
          }),
        }),
      }),
    }),
  }),
}));

import { getCurrentStaffResult } from "@/platform/auth/current-staff";

beforeEach(() => {
  rpc.mockReset();
});

it("tries the permission read a second time before refusing", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: "timeout" } }).mockResolvedValueOnce({ data: ["attendance:mark"], error: null });
  const result = await getCurrentStaffResult();
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(result.staff?.permissions).toEqual(["attendance:mark"]);
});

it("still refuses when both reads fail", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
  await expect(getCurrentStaffResult()).rejects.toThrow("Could not verify staff permissions");
  expect(rpc).toHaveBeenCalledTimes(2);
});

it("asks once when the first read answers", async () => {
  rpc.mockResolvedValue({ data: ["attendance:mark"], error: null });
  await getCurrentStaffResult();
  expect(rpc).toHaveBeenCalledTimes(1);
});
