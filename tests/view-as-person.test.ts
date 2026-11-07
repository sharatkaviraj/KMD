import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "See One as a person" (D-544): an administrator chooses a member of staff
 * and One draws every screen as that person sees it, with their real data,
 * and saves nothing. Synthetic ids and a stubbed network; nothing real.
 */

const mocks = vi.hoisted(() => ({
  cookie: { value: undefined as string | undefined },
  viewing: { value: null as null | { language: "en" | "hi" | "both" } },
  staffThrows: { value: false },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "vx_view_person" && mocks.cookie.value ? { value: mocks.cookie.value } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/platform/auth/current-staff", () => ({
  getCurrentStaff: async () => {
    if (mocks.staffThrows.value) throw new Error("profile read failed");
    return mocks.viewing.value ? { id: "subject", viewedBy: { language: mocks.viewing.value.language } } : { id: "admin" };
  },
}));

import { encodeViewAsPerson, isUuid, readViewAsPerson, viewAsPersonBelongsTo } from "@/platform/auth/view-as-cookie";
import {
  classifyViewAsRequest,
  refusedWhileViewingAs,
  VIEW_AS_CONTROL_FUNCTIONS,
  VIEW_AS_HEADER,
  VIEW_AS_REFUSAL_CODE,
} from "@/platform/auth/view-as-requests";
import { READ_ONLY_FUNCTIONS } from "@/platform/auth/view-as-read-only-functions";
import { resolvingStaff } from "@/platform/auth/staff-resolution-context";
import { mayViewAs } from "@/platform/auth/view-as-subject";
import { createViewAsGuardedFetch } from "@/platform/supabase/view-as-guard";
import { inGroup, matchesSearch, seeAsLabel, shortName } from "@/vx/screens/view-as/logic";
import { languageSwitch } from "@/vx/shell/person-language";

const ADMIN_USER = "00000000-0000-4000-8000-0000000000a1";
const OTHER_USER = "00000000-0000-4000-8000-0000000000a2";
const ADMIN_STAFF = "00000000-0000-4000-8000-0000000000b1";
const TEACHER_STAFF = "00000000-0000-4000-8000-0000000000c1";
const REST = "https://synthetic.supabase.co/rest/v1";
const COOKIE = `${ADMIN_USER}.${TEACHER_STAFF}`;

describe("the view-as cookie", () => {
  it("round-trips the administrator and the chosen person", () => {
    const value = encodeViewAsPerson(ADMIN_USER.toUpperCase(), TEACHER_STAFF);
    expect(value).toBe(COOKIE);
    expect(readViewAsPerson(value)).toEqual({ actorUserId: ADMIN_USER, subjectId: TEACHER_STAFF });
  });

  it("reads anything else as no view at all", () => {
    for (const bad of [undefined, null, "", "x", `${ADMIN_USER}`, `${ADMIN_USER}.${TEACHER_STAFF}.x`, `${ADMIN_USER}.not-a-uuid`, `${"a".repeat(81)}`]) {
      expect(readViewAsPerson(bad)).toBeNull();
    }
    expect(() => encodeViewAsPerson("x", TEACHER_STAFF)).toThrow();
    expect(isUuid(TEACHER_STAFF)).toBe(true);
    expect(isUuid("1")).toBe(false);
  });

  it("belongs only to the person who set it", () => {
    expect(viewAsPersonBelongsTo(COOKIE, ADMIN_USER)).toBe(true);
    expect(viewAsPersonBelongsTo(COOKIE, ADMIN_USER.toUpperCase())).toBe(true);
    expect(viewAsPersonBelongsTo(COOKIE, OTHER_USER)).toBe(false);
    expect(viewAsPersonBelongsTo(COOKIE, null)).toBe(false);
    expect(viewAsPersonBelongsTo("junk", ADMIN_USER)).toBe(false);
  });
});

describe("who an administrator may see One as", () => {
  const admin = { id: ADMIN_STAFF, role: "admin", isActive: true, isTestAccount: false };
  const teacher = { id: TEACHER_STAFF, role: "teacher", is_active: true, is_test_account: false };

  it("an active administrator, any active member of staff who is not an administrator", () => {
    expect(mayViewAs(admin, teacher)).toBe(true);
    expect(mayViewAs(admin, { ...teacher, role: "accountant" })).toBe(true);
    expect(mayViewAs(admin, { ...teacher, role: "office" })).toBe(true);
  });

  it("never themselves, another administrator, or somebody inactive", () => {
    expect(mayViewAs(admin, { ...teacher, id: ADMIN_STAFF })).toBe(false);
    expect(mayViewAs(admin, { ...teacher, role: "admin" })).toBe(false);
    expect(mayViewAs(admin, { ...teacher, is_active: false })).toBe(false);
  });

  it("only an active, real administrator may look at all", () => {
    expect(mayViewAs({ ...admin, role: "teacher" }, teacher)).toBe(false);
    expect(mayViewAs({ ...admin, isActive: false }, teacher)).toBe(false);
    expect(mayViewAs({ ...admin, smokeLab: true }, teacher)).toBe(false);
  });

  it("a test administrator looks only at test accounts; a real one at practice accounts too", () => {
    const testAdmin = { ...admin, isTestAccount: true };
    expect(mayViewAs(testAdmin, teacher)).toBe(false);
    expect(mayViewAs(testAdmin, { ...teacher, is_test_account: true })).toBe(true);
    expect(mayViewAs(admin, { ...teacher, is_test_account: true })).toBe(true);
  });
});

describe("which database requests are saves", () => {
  it("passes the administrator's own session and the two view controls", () => {
    expect(classifyViewAsRequest("https://synthetic.supabase.co/auth/v1/token?grant_type=refresh_token", "POST")).toBe("auth");
    expect(classifyViewAsRequest("https://synthetic.supabase.co/auth/v1/logout", "POST")).toBe("auth");
    expect(classifyViewAsRequest(`${REST}/rpc/view_as_begin`, "POST")).toBe("control");
    expect(classifyViewAsRequest(`${REST}/rpc/view_as_end`, "POST")).toBe("control");
    expect([...VIEW_AS_CONTROL_FUNCTIONS].sort()).toEqual(["view_as_begin", "view_as_end"]);
  });

  it("reads a GET, a HEAD, a read-only function and a signed file link", () => {
    expect(classifyViewAsRequest(`${REST}/students?select=id`, "GET")).toBe("read");
    expect(classifyViewAsRequest(`${REST}/students?select=id`, undefined)).toBe("read");
    expect(classifyViewAsRequest(`${REST}/students`, "HEAD")).toBe("read");
    expect(classifyViewAsRequest(`${REST}/rpc/attendance_roster`, "POST", READ_ONLY_FUNCTIONS)).toBe("read");
    expect(classifyViewAsRequest(`${REST}/rpc/my_permissions`, "POST", READ_ONLY_FUNCTIONS)).toBe("read");
    expect(classifyViewAsRequest("https://synthetic.supabase.co/storage/v1/object/sign/staff-photos/a.jpg", "POST")).toBe("read");
    expect(classifyViewAsRequest("https://synthetic.supabase.co/storage/v1/object/sign/staff-photos", "POST")).toBe("read");
    expect(classifyViewAsRequest("https://synthetic.supabase.co/storage/v1/object/list/staff-photos", "POST")).toBe("read");
  });

  it("calls every table write, every other function and every upload a save", () => {
    expect(classifyViewAsRequest(`${REST}/attendance_marks`, "POST")).toBe("write");
    expect(classifyViewAsRequest(`${REST}/attendance_marks?id=eq.1`, "PATCH")).toBe("write");
    expect(classifyViewAsRequest(`${REST}/attendance_marks?id=eq.1`, "DELETE")).toBe("write");
    expect(classifyViewAsRequest(`${REST}/attendance_marks`, "PUT")).toBe("write");
    expect(classifyViewAsRequest(`${REST}/rpc/post_student_payment_with_adjustments`, "POST", READ_ONLY_FUNCTIONS)).toBe("write");
    expect(classifyViewAsRequest(`${REST}/rpc/mark_teacher_task_opened`, "POST", READ_ONLY_FUNCTIONS)).toBe("write");
    expect(classifyViewAsRequest(`${REST}/rpc/some_function_added_tomorrow`, "POST", READ_ONLY_FUNCTIONS)).toBe("write");
    expect(classifyViewAsRequest("https://synthetic.supabase.co/storage/v1/object/student-photos/a.jpg", "POST")).toBe("write");
    expect(classifyViewAsRequest("https://synthetic.supabase.co/functions/v1/anything", "POST")).toBe("write");
    expect(classifyViewAsRequest("not a url", "GET")).toBe("write");
  });

  it("treats every function call as a save when no list is given, as the browser does", () => {
    expect(classifyViewAsRequest(`${REST}/rpc/attendance_roster`, "POST")).toBe("write");
    expect(classifyViewAsRequest(`${REST}/rpc/my_permissions`, "POST")).toBe("write");
    expect(classifyViewAsRequest(`${REST}/rpc/view_as_end`, "POST")).toBe("control");
    expect(classifyViewAsRequest(`${REST}/students?select=id`, "GET")).toBe("read");
  });

  it("never lists a function that writes as read-only", () => {
    for (const writer of ["view_as_begin", "view_as_end", "post_student_payment", "post_student_payment_with_adjustments", "online_payment_quote_for", "school_certificate_current_v2", "mark_teacher_task_opened", "waive_late_fee"]) {
      expect(READ_ONLY_FUNCTIONS.has(writer)).toBe(false);
    }
  });
});

describe("the proxy's refusal", () => {
  const base = { method: "POST", pathname: "/api/assist/run", serverAction: false, cookie: COOKIE, userId: ADMIN_USER };

  it("refuses a command to an API route or a document while the view is the signed-in person's", () => {
    expect(refusedWhileViewingAs(base)).toBe(true);
    expect(refusedWhileViewingAs({ ...base, pathname: "/documents/upload" })).toBe(true);
    expect(refusedWhileViewingAs({ ...base, method: "DELETE" })).toBe(true);
  });

  it("lets reads, pages and server actions through", () => {
    expect(refusedWhileViewingAs({ ...base, method: "GET" })).toBe(false);
    expect(refusedWhileViewingAs({ ...base, method: "HEAD" })).toBe(false);
    expect(refusedWhileViewingAs({ ...base, serverAction: true })).toBe(false);
    expect(refusedWhileViewingAs({ ...base, pathname: "/teach/attendance" })).toBe(false);
  });

  it("ignores a cookie somebody else left behind", () => {
    expect(refusedWhileViewingAs({ ...base, userId: OTHER_USER })).toBe(false);
    expect(refusedWhileViewingAs({ ...base, cookie: null })).toBe(false);
    expect(refusedWhileViewingAs({ ...base, userId: null })).toBe(false);
  });
});

describe("the data clients' lock", () => {
  type Call = { url: string; init?: RequestInit };
  let calls: Call[];
  const underlying = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    return new Response("[]", { status: 200 });
  }) as typeof fetch;

  beforeEach(() => {
    calls = [];
    mocks.cookie.value = undefined;
    mocks.viewing.value = null;
    mocks.staffThrows.value = false;
  });

  it("draws the signed-in person's reads as the chosen person", async () => {
    const guarded = createViewAsGuardedFetch(underlying, { cookie: () => COOKIE, drawAsChosen: true });
    await guarded(`${REST}/students?select=id`, { method: "GET", headers: { apikey: "k" } });
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get(VIEW_AS_HEADER)).toBe(TEACHER_STAFF);
    expect(headers.get("apikey")).toBe("k");
  });

  it("never draws the service role's reads, nor reads without a view, as anybody", async () => {
    const service = createViewAsGuardedFetch(underlying);
    mocks.cookie.value = COOKIE;
    await service(`${REST}/students?select=id`, { method: "GET" });
    expect(new Headers(calls[0].init?.headers).has(VIEW_AS_HEADER)).toBe(false);

    const own = createViewAsGuardedFetch(underlying, { cookie: () => undefined, drawAsChosen: true });
    await own(`${REST}/students?select=id`, { method: "GET" });
    expect(new Headers(calls[1].init?.headers).has(VIEW_AS_HEADER)).toBe(false);
  });

  it("refuses a save while the view is really on, in the administrator's language", async () => {
    mocks.viewing.value = { language: "hi" };
    const guarded = createViewAsGuardedFetch(underlying, { cookie: () => COOKIE, drawAsChosen: true });
    const res = await guarded(`${REST}/attendance_marks`, { method: "POST", body: "{}" });
    expect(calls).toHaveLength(0);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(VIEW_AS_REFUSAL_CODE);
    expect(body.message).toMatch(/कुछ सहेजा नहीं गया/);
  });

  it("refuses on the service role too, reading the request's cookie", async () => {
    mocks.viewing.value = { language: "en" };
    mocks.cookie.value = COOKIE;
    const service = createViewAsGuardedFetch(underlying);
    const res = await service(`${REST}/rpc/post_student_payment_with_adjustments`, { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("saves as before when the cookie outlived its view or there is none", async () => {
    const guarded = createViewAsGuardedFetch(underlying, { cookie: () => COOKIE, drawAsChosen: true });
    const res = await guarded(`${REST}/attendance_marks`, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);

    const service = createViewAsGuardedFetch(underlying);
    await service(`${REST}/attendance_marks`, { method: "POST", body: "{}" });
    expect(calls).toHaveLength(2);
  });

  it("refuses when it cannot tell, rather than saving as the administrator", async () => {
    mocks.staffThrows.value = true;
    const guarded = createViewAsGuardedFetch(underlying, { cookie: () => COOKIE, drawAsChosen: true });
    const res = await guarded(`${REST}/attendance_marks`, { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("lets the reads that work out who the request is for pass untouched", async () => {
    mocks.viewing.value = { language: "en" };
    const guarded = createViewAsGuardedFetch(underlying, { cookie: () => COOKIE, drawAsChosen: true });
    await resolvingStaff(async () => {
      await guarded(`${REST}/staff_profiles?select=id`, { method: "GET" });
      await guarded(`${REST}/rpc/touch_staff_last_seen`, { method: "POST" });
    });
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0].init?.headers).has(VIEW_AS_HEADER)).toBe(false);
  });

  it("passes the view's own controls and the administrator's sign-in", async () => {
    mocks.viewing.value = { language: "en" };
    const guarded = createViewAsGuardedFetch(underlying, { cookie: () => COOKIE, drawAsChosen: true });
    await guarded(`${REST}/rpc/view_as_end`, { method: "POST", body: "{}" });
    await guarded("https://synthetic.supabase.co/auth/v1/logout", { method: "POST" });
    expect(calls).toHaveLength(2);
  });
});

describe("the picker", () => {
  const person = { name: "Synthetic Teacher", role: "teacher" as const, classes: ["6 A"], practice: false };

  it("finds a person by name, role in either language, or class", () => {
    expect(matchesSearch(person, "")).toBe(true);
    expect(matchesSearch(person, "synth")).toBe(true);
    expect(matchesSearch(person, "  TEACHER  ")).toBe(true);
    expect(matchesSearch(person, "अध्यापक")).toBe(true);
    expect(matchesSearch(person, "6 a")).toBe(true);
    expect(matchesSearch(person, "accountant")).toBe(false);
  });

  it("puts a practice account only under Practice", () => {
    expect(inGroup("teachers", person)).toBe(true);
    expect(inGroup("practice", person)).toBe(false);
    expect(inGroup("teachers", { ...person, practice: true })).toBe(false);
    expect(inGroup("practice", { ...person, practice: true })).toBe(true);
    expect(inGroup("all", { ...person, practice: true })).toBe(true);
    expect(inGroup("coordinators", { ...person, role: "exam_coordinator" })).toBe(true);
    expect(inGroup("accounts", { ...person, role: "fee_collector" })).toBe(true);
    expect(inGroup("office", { ...person, role: "view_only" })).toBe(true);
  });

  it("keeps the button short", () => {
    expect(shortName("Synthetic Teacher")).toBe("Synthetic Teacher");
    expect(shortName("Smt. Synthetica Longname-Teacher")).toBe("Synthetica");
    expect(seeAsLabel("Synthetic Teacher")).toEqual({ en: "See as Synthetic Teacher", hi: "Synthetic Teacher की नज़र से देखें" });
  });
});

describe("the banner's one language button", () => {
  it("offers the administrator's language, then the way back to the person's", () => {
    expect(languageSwitch("hi", "hi", "en", "Asha")).toEqual({ to: "en", label: { en: "Show in English", hi: "English में दिखाएँ" } });
    expect(languageSwitch("en", "hi", "en", "Asha")?.to).toBe("hi");
    expect(languageSwitch("en", "en", "en", "Asha")).toBeNull();
  });
});

describe("the database half (migration 20261107164847)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261107164847_view_as_person.sql"), "utf8");
  const fn = (name: string) => {
    const start = sql.indexOf(`create or replace function vppsone.${name}(`);
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("$$;", start));
  };

  it("honours a view only in a read-only transaction, behind an open grant", () => {
    const body = fn("view_as_subject_id");
    expect(body).toMatch(/transaction_read_only/);
    expect(body).toMatch(/view_as_log/);
    expect(body).toMatch(/expires_at/);
    expect(sql).toMatch(/revoke all on function vppsone\.view_as_subject_id\(\) from public, anon, authenticated;/);
  });

  it("starts a view only for an active administrator", () => {
    const body = fn("view_as_begin");
    expect(body).toMatch(/auth\.uid\(\)/);
    expect(body).toMatch(/Only an administrator can see One as another person\./);
    expect(body).toMatch(/Choose a member of staff who is not an administrator\./);
    expect(body).toMatch(/A test account can only see One as another test account\./);
  });
});

describe("the browser clients' lock", () => {
  it("refuses a direct upload while the view is on, and only then", async () => {
    const { viewAsBrowserFetch, VIEW_AS_DOCUMENT_FLAG } = await import("@/platform/supabase/view-as-browser");
    const attrs = new Set<string>();
    const sent: string[] = [];
    vi.stubGlobal("document", {
      documentElement: { hasAttribute: (name: string) => attrs.has(name) },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      sent.push(input.toString());
      return new Response("{}", { status: 200 });
    });
    try {
      const upload = "https://synthetic.supabase.co/storage/v1/object/student-photos/a.jpg";
      expect((await viewAsBrowserFetch(upload, { method: "POST" })).status).toBe(200);

      attrs.add(VIEW_AS_DOCUMENT_FLAG);
      const refused = await viewAsBrowserFetch(upload, { method: "POST" });
      expect(refused.status).toBe(403);
      expect((await refused.json()).code).toBe(VIEW_AS_REFUSAL_CODE);
      expect((await viewAsBrowserFetch("https://synthetic.supabase.co/storage/v1/object/upload/sign/b/a.jpg?token=t", { method: "PUT" })).status).toBe(403);
      // Reads and the administrator's own session still go.
      expect((await viewAsBrowserFetch(`${REST}/students?select=id`, { method: "GET" })).status).toBe(200);
      expect((await viewAsBrowserFetch("https://synthetic.supabase.co/auth/v1/user", { method: "GET" })).status).toBe(200);
      expect(sent).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("moving into and out of a view", () => {
  const src = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  /** From the action's call to the line after the push that follows it. */
  const afterAction = (code: string, action: string) => {
    const at = code.indexOf(`await ${action}(`);
    expect(at, action).toBeGreaterThan(-1);
    const push = code.indexOf("router.push(", at);
    expect(push, action).toBeGreaterThan(at);
    return code.slice(at, code.indexOf("\n", code.indexOf("\n", push) + 1));
  };

  it("pushes once, from the top: the action has already redrawn the frame", () => {
    const handlers: [string, string][] = [
      ["src/vx/screens/view-as/view-as-screen.tsx", "startViewAsPersonAction"],
      ["src/vx/screens/view-as/view-as-screen.tsx", "endViewAsPersonAction"],
      ["src/vx/shell/person-banner.tsx", "endViewAsPersonAction"],
      ["src/vx/shell/preview-links.tsx", "setViewAsAction"],
      ["src/app/(app)/menu/menu-screen.tsx", "setViewAsAction"],
      ["src/vx/shell/preview-banner.tsx", "clearViewAsAction"],
    ];
    for (const [path, action] of handlers) {
      const handler = afterAction(src(path), action);
      expect(handler, `${path} ${action}`).toContain("window.scrollTo(0, 0);");
      expect(handler, `${path} ${action}`).toMatch(/router\.push\([^\n]*, \{ scroll: false \}\);/);
      expect(handler, `${path} ${action}`).not.toContain("router.refresh()");
    }
  });

  it("keeps the sidebar's See the app as lines above its sliding highlight", () => {
    expect(src("src/vx/shell/preview-links.tsx")).toMatch(/style=\{\{ position: "relative",/);
  });
});
