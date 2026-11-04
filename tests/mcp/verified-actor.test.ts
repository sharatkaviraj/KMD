import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The verified-actor twins (`…As(actor, …)`) and the resolver that mints the
 * actor. The twins read through the service role, so each must make the
 * screen's own check AND the database's test-session fence itself (L1); only
 * the resolver may mint an actor (L2). The service-role client is faked; the
 * cookie helpers throw, proving no twin falls back to a cookie.
 */

vi.mock("server-only", () => ({}));

type Call = { table: string; filters: [string, string, unknown][] };
const db = vi.hoisted(() => ({
  calls: [] as { table: string; filters: [string, string, unknown][] }[],
  rows: {} as Record<string, unknown[]>,
  rpc: vi.fn(),
}));

function builder(table: string) {
  const call: Call = { table, filters: [] };
  db.calls.push(call);
  const result = () => ({ data: db.rows[table] ?? [], error: null });
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "range", "returns", "neq", "is", "not"]) chain[method] = () => chain;
  chain.eq = (column: string, value: unknown) => (call.filters.push(["eq", column, value]), chain);
  chain.in = (column: string, value: unknown) => (call.filters.push(["in", column, value]), chain);
  chain.maybeSingle = async () => ({ data: (db.rows[table] ?? [])[0] ?? null, error: null });
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return chain;
}

vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({ from: builder, schema: () => ({ from: builder }), rpc: db.rpc }),
}));
vi.mock("@/platform/supabase/server", () => ({
  createClient: async () => {
    throw new Error("cookie client used");
  },
}));
vi.mock("@/platform/auth/current-staff", () => ({
  assertStaff: async () => {
    throw new Error("cookie staff used");
  },
  assertPermission: async () => {
    throw new Error("cookie staff used");
  },
  getCurrentStaff: async () => {
    throw new Error("cookie staff used");
  },
  testAccountFlags: (flag: boolean, env: Record<string, string | undefined> = process.env) => {
    const confined = env.VERCEL_ENV !== "production";
    return { isTestAccount: flag || confined, confined };
  },
}));
vi.mock("@/platform/performance/shared-cache", () => ({
  sharedCache: (read: (...args: unknown[]) => unknown) => read,
  CACHE_TAGS: new Proxy({}, { get: (_target, key) => String(key) }),
  expireTag: () => undefined,
}));

const { isVerifiedActor, mintVerifiedActor, assertActorStaff } = await import("@/platform/auth/verified-actor");
const { absencesOnAs } = await import("@/modules/substitutions/data/absences-repo");
const { dutiesOnAs } = await import("@/modules/substitutions/data/cover-repo");
const { attendanceCalendarAs, attendanceRulesAs, markStatusesAs, registersForDayAs } = await import("@/modules/attendance/data/attendance-repo");
const { listEnrolmentsAs } = await import("@/modules/enrolments/data/enrolments-repo");
const { listStaffAs } = await import("@/modules/staff/data/staff-repo");
const { classLabelMapAs } = await import("@/modules/academics/data/academics-repo");
const { askedLeaveForActor, boardForActor } = await import("@/vx/screens/admin/data");
const { resolveStaffForUser } = await import("@/modules/mcp/data/staff");

const base = {
  email: null,
  shortName: "S",
  isTeaching: false,
  isActive: true,
  language: "en" as const,
  preferredStart: null,
  permissions: null,
};
const realAdmin = () => mintVerifiedActor({ ...base, id: "a", userId: "ua", displayName: "Real Admin", role: "admin", isTestAccount: false, confined: false });
const testAdmin = () => mintVerifiedActor({ ...base, id: "b", userId: "ub", displayName: "Test Admin", role: "admin", isTestAccount: true, confined: true });
const realTeacher = () => mintVerifiedActor({ ...base, id: "c", userId: "uc", displayName: "Real Teacher", role: "teacher", isTestAccount: false, confined: false });
const testTeacher = () => mintVerifiedActor({ ...base, id: "d", userId: "ud", displayName: "Test Teacher", role: "teacher", isTestAccount: true, confined: true });

beforeEach(() => {
  db.calls.length = 0;
  db.rows = {};
  db.rpc.mockReset();
});

describe("only the resolver mints a verified actor (L2)", () => {
  it("refuses a look-alike object, even a copy of a real actor", () => {
    const actor = realAdmin();
    expect(isVerifiedActor(actor)).toBe(true);
    expect(isVerifiedActor({ ...actor })).toBe(false);
    expect(isVerifiedActor({ ...actor, verifiedBy: "ai_connection" })).toBe(false);
    expect(() => assertActorStaff({ ...actor })).toThrow(/Not signed in/);
  });

  it("freezes the actor so its role or permissions cannot be changed after minting", () => {
    const actor = mintVerifiedActor({ ...base, id: "x", userId: "ux", displayName: "X", role: "teacher", permissions: ["dashboard:view"] });
    expect(Object.isFrozen(actor)).toBe(true);
    expect(() => {
      (actor as { role: string }).role = "admin";
    }).toThrow();
    expect(() => (actor.permissions as string[]).push("staff:manage")).toThrow();
  });

  it("is called from the resolver and nowhere else in src", () => {
    const src = path.resolve(__dirname, "../../src");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const callers = walk(src)
      .filter((file) => /\.tsx?$/.test(file) && /mintVerifiedActor\(/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(src, file).replace(/\\/g, "/"));
    expect(callers.sort()).toEqual(["modules/mcp/data/staff.ts", "platform/auth/verified-actor.ts"]);
  }, 60_000);
});

describe("resolveStaffForUser reads the profile and the matrix now", () => {
  const row = { id: "p1", display_name: "Real Admin", short_name: "RA", role: "admin", is_teaching: false, is_active: true, preferred_language: "hi", is_test_account: false, permissions: ["dashboard:view"] };

  it("mints a frozen verified actor with the profile's fields and the matrix's permissions", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    db.rpc.mockResolvedValue({ data: row, error: null });
    const actor = await resolveStaffForUser("u1");
    expect(db.rpc).toHaveBeenCalledWith("ai_staff_for_user", { p_user_id: "u1" });
    expect(isVerifiedActor(actor)).toBe(true);
    expect(actor).toMatchObject({ id: "p1", userId: "u1", role: "admin", isActive: true, language: "hi", permissions: ["dashboard:view"], isTestAccount: false, confined: false, qaAccount: false });
    vi.unstubAllEnvs();
  });

  it("makes every account a test account on a confined deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    db.rpc.mockResolvedValue({ data: row, error: null });
    expect(await resolveStaffForUser("u1")).toMatchObject({ isTestAccount: true, confined: true });
    vi.unstubAllEnvs();
  });

  it("narrows an unknown role, keeps an inactive profile inactive, flags QA identities", async () => {
    db.rpc.mockResolvedValue({ data: { ...row, role: "superuser", is_active: false }, error: null });
    expect(await resolveStaffForUser("u1")).toMatchObject({ role: "view_only", isActive: false });
    db.rpc.mockResolvedValue({ data: row, error: null });
    expect(await resolveStaffForUser("3f64f814-5d57-4b1c-a860-725eb65efda7")).toMatchObject({ qaAccount: true });
  });

  it("returns null with no profile and refuses an unreadable matrix or a failed read", async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    expect(await resolveStaffForUser("u1")).toBeNull();
    db.rpc.mockResolvedValue({ data: { ...row, permissions: "everything" }, error: null });
    await expect(resolveStaffForUser("u1")).rejects.toThrow(/permissions/);
    db.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(resolveStaffForUser("u1")).rejects.toThrow();
  });
});

describe("every twin applies the test-session fence itself (L1)", () => {
  const twins: [string, (actor: unknown, label: string) => Promise<unknown>][] = [
    ["absencesOnAs", (actor, label) => absencesOnAs(actor as never, label, "2026-11-03", { withReason: false })],
    ["dutiesOnAs", (actor, label) => dutiesOnAs(actor as never, label, "2026-11-03")],
    ["registersForDayAs", (actor, label) => registersForDayAs(actor as never, label, "2026-11-03")],
    ["markStatusesAs", (actor, label) => markStatusesAs(actor as never, label, ["r1"])],
    ["listEnrolmentsAs", (actor, label) => listEnrolmentsAs(actor as never, label)],
    ["attendanceCalendarAs", (actor, label) => attendanceCalendarAs(actor as never, label)],
    ["attendanceRulesAs", (actor, label) => attendanceRulesAs(actor as never, label)],
    ["classLabelMapAs", (actor, label) => classLabelMapAs(actor as never, label)],
    ["askedLeaveForActor", (actor, label) => askedLeaveForActor(actor as never, label)],
    ["boardForActor", (actor, label) => boardForActor(actor as never, label, "2026-11-03")],
  ];

  it.each(twins)("%s refuses a test account a real session before reading", async (_name, twin) => {
    await expect(twin(testAdmin(), "2026-27")).rejects.toThrow(/Session not available/);
    expect(db.calls).toEqual([]);
  });

  it.each(twins)("%s lets a real admin read either session", async (_name, twin) => {
    await expect(twin(realAdmin(), "2026-27")).resolves.toBeDefined();
    await expect(twin(realAdmin(), "TEST-2026-27")).resolves.toBeDefined();
  });

  it.each(twins)("%s refuses a look-alike actor before reading", async (_name, twin) => {
    await expect(twin({ ...realAdmin() }, "2026-27")).rejects.toThrow(/Not signed in/);
    expect(db.calls).toEqual([]);
  });

  it("a real non-admin never reads TEST, and a test non-admin never reads real", async () => {
    await expect(absencesOnAs(realTeacher(), "TEST-2026-27", "2026-11-03", { withReason: false })).rejects.toThrow(/Session/);
    await expect(absencesOnAs(testTeacher(), "2026-27", "2026-11-03", { withReason: false })).rejects.toThrow(/Session/);
  });

  it("keeps each screen's own permission and every-class rules", async () => {
    const narrowed = mintVerifiedActor({ ...base, id: "e", userId: "ue", displayName: "Narrow", role: "teacher", permissions: ["dashboard:view"], isTestAccount: false });
    await expect(dutiesOnAs(narrowed, "2026-27", "2026-11-03")).rejects.toThrow(/substitutions:view/);
    await expect(askedLeaveForActor(realTeacher(), "2026-27")).rejects.toThrow(/substitutions:manage/);
    await expect(registersForDayAs(realTeacher(), "2026-27", "2026-11-03")).rejects.toThrow(/every class/);
    await expect(boardForActor(realTeacher(), "2026-27", "2026-11-03")).rejects.toThrow(/every class/);
    expect(db.calls).toEqual([]);
  });

  it("never returns the absence reason unless asked for by someone who manages cover", async () => {
    db.rows.teacher_absences = [{ id: "x", staff_profile_id: "s", day: "2026-11-03", periods: [], reason: "Hospital", staff_profiles: { display_name: "N", short_name: "N" } }];
    const [withheld] = await absencesOnAs(realAdmin(), "2026-27", "2026-11-03", { withReason: false });
    expect(withheld.reason).toBeNull();
    const [shown] = await absencesOnAs(realAdmin(), "2026-27", "2026-11-03", { withReason: true });
    expect(shown.reason).toBe("Hospital");
    const [teacherAsked] = await absencesOnAs(realTeacher(), "2026-27", "2026-11-03", { withReason: true });
    expect(teacherAsked.reason).toBeNull();
  });

  it("reads marks only for registers of the fenced session", async () => {
    db.rows.attendance_registers = [{ id: "r1" }];
    db.rows.attendance_marks = [{ register_id: "r1", status: "present" }];
    await markStatusesAs(realAdmin(), "2026-27", ["r1", "r-from-elsewhere"]);
    const registers = db.calls.find((c) => c.table === "attendance_registers")!;
    expect(registers.filters).toContainEqual(["eq", "session_label", "2026-27"]);
    const marks = db.calls.find((c) => c.table === "attendance_marks")!;
    expect(marks.filters).toContainEqual(["in", "register_id", ["r1"]]);
  });

  it("never reads a colleague's phone number for the AI connection", async () => {
    db.rows.staff_profiles = [{ id: "s", user_id: null, display_name: "N", short_name: "N", role: "teacher", phone: "9999999999", whatsapp_phone: "9999999998", is_teaching: true, is_active: true }];
    const [person] = await listStaffAs(realAdmin());
    expect(JSON.stringify(person)).not.toContain("9999999999");
  });
});
