import { describe, expect, it } from "vitest";

import { staffRoles, type StaffRole } from "@/platform/auth/permissions";
import {
  canAccessSession,
  canSeeTestSessions,
  canSwitchSessions,
  chooseVisibleSession,
  defaultSessionFor,
  filterSessionsForViewer,
  isRealAdmin,
  isTestSessionLabel,
  listsTestStaff,
  staffBelongsToSession,
  TEST_SESSION_LABEL,
  UNREADABLE_VIEWER,
} from "@/platform/auth/test-session-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";

/**
 * Phase 3 (D-340; critique0 #13, #14): who sees and writes which session.
 * The matrix is every role × real/test account × real/test/coming label ×
 * read/write. Read and write are the same answer — the database fence is the
 * same predicate in USING and WITH CHECK — and the test says so per cell, so
 * a future split has to change this file on purpose.
 */

const LABELS = { real: "2026-27", coming: "2027-28", test: "TEST-2026-27", uat: "UAT-2026-27" } as const;

function expected(role: StaffRole, isTestAccount: boolean, label: string): boolean {
  if (role === "admin" && !isTestAccount) return true; // a real admin: both
  return isTestSessionLabel(label) === isTestAccount;
}

describe("the session fence, role × account × label × read/write", () => {
  for (const role of staffRoles) {
    for (const isTestAccount of [false, true]) {
      for (const [name, label] of Object.entries(LABELS)) {
        for (const mode of ["read", "write"] as const) {
          it(`${role}${isTestAccount ? " (test account)" : ""} ${mode} ${name} ${label}`, () => {
            // One function answers both: see the file header.
            expect(canAccessSession({ role, isTestAccount }, label)).toBe(expected(role, isTestAccount, label));
          });
        }
      }
    }
  }

  it("a test admin is fenced like every test account (critique0 #14)", () => {
    const testAdmin = { role: "admin" as const, isTestAccount: true };
    expect(isRealAdmin(testAdmin)).toBe(false);
    expect(canAccessSession(testAdmin, "2026-27")).toBe(false);
    expect(canAccessSession(testAdmin, TEST_SESSION_LABEL)).toBe(true);
    expect(canSeeTestSessions(testAdmin)).toBe(true);
  });

  it("an absent flag reads as a real account (hand-built fixtures), never as an admin bypass", () => {
    expect(canAccessSession({ role: "office" }, TEST_SESSION_LABEL)).toBe(false);
    expect(canAccessSession({ role: "office" }, "2026-27")).toBe(true);
    expect(isRealAdmin({ role: "admin" })).toBe(true);
  });

  it("a malformed or empty label is not a test session", () => {
    expect(isTestSessionLabel("TEST")).toBe(false);
    expect(isTestSessionLabel("")).toBe(false);
    expect(isTestSessionLabel(null)).toBe(false);
    expect(isTestSessionLabel("test-2026-27")).toBe(true);
    expect(isTestSessionLabel("DEMO-2026-27")).toBe(true);
  });
});

describe("who gets the pill", () => {
  it("fee readers, both coordinators, the admin and every test account; not a teacher", () => {
    expect(canSwitchSessions({ role: "teacher", isTestAccount: false, feeReader: false })).toBe(false);
    expect(canSwitchSessions({ role: "view_only", isTestAccount: false, feeReader: false })).toBe(false);
    expect(canSwitchSessions({ role: "office", isTestAccount: false, feeReader: true })).toBe(true);
    expect(canSwitchSessions({ role: "academic_coordinator", isTestAccount: false, feeReader: false })).toBe(true);
    expect(canSwitchSessions({ role: "exam_coordinator", isTestAccount: false, feeReader: false })).toBe(true);
    expect(canSwitchSessions({ role: "admin", isTestAccount: false, feeReader: true })).toBe(true);
    expect(canSwitchSessions({ role: "teacher", isTestAccount: true, feeReader: false })).toBe(true);
  });
});

describe("the switcher list for one viewer", () => {
  const rows = [
    { session_label: "2026-27" },
    { session_label: "2027-28" },
    { session_label: "TEST-2026-27" },
  ];
  const labels = (viewer: Parameters<typeof filterSessionsForViewer>[1]) =>
    filterSessionsForViewer(rows, viewer, "2026-27").map((row) => row.session_label);

  it("a real fee reader sees the real years, the coming one included, and never TEST", () => {
    expect(labels({ role: "accountant", isTestAccount: false, feeReader: true })).toEqual(["2026-27", "2027-28"]);
  });
  it("a coordinator (not a fee reader) sees the current year only", () => {
    expect(labels({ role: "academic_coordinator", isTestAccount: false, feeReader: false })).toEqual(["2026-27"]);
  });
  it("a real admin sees all three", () => {
    expect(labels({ role: "admin", isTestAccount: false, feeReader: true })).toEqual(["2026-27", "2027-28", "TEST-2026-27"]);
  });
  it("a test account sees TEST only, whatever its role", () => {
    for (const role of staffRoles) {
      expect(labels({ role, isTestAccount: true, feeReader: true })).toEqual(["TEST-2026-27"]);
    }
  });
});

describe("resolving a requested session", () => {
  const office = { role: "office" as const, isTestAccount: false };
  const tester = { role: "office" as const, isTestAccount: true };

  it("a real member of staff handed ?session=TEST-2026-27 lands on the active session, flagged", () => {
    expect(chooseVisibleSession({ viewer: office, requested: "TEST-2026-27", activeSessionLabel: "2026-27" })).toEqual({
      sessionLabel: "2026-27",
      forbidden: true,
    });
  });
  it("a test account with a 2026-27 cookie lands on TEST-2026-27, flagged", () => {
    expect(chooseVisibleSession({ viewer: tester, requested: "2026-27", activeSessionLabel: "2026-27" })).toEqual({
      sessionLabel: TEST_SESSION_LABEL,
      forbidden: true,
    });
  });
  it("an allowed request is kept, and nothing asked is not a refusal", () => {
    expect(chooseVisibleSession({ viewer: office, requested: "2027-28", activeSessionLabel: "2026-27" }).sessionLabel).toBe("2027-28");
    expect(chooseVisibleSession({ viewer: tester, requested: null, activeSessionLabel: "2026-27" })).toEqual({
      sessionLabel: TEST_SESSION_LABEL,
      forbidden: false,
    });
  });
  it("test accounts default to TEST-2026-27, everybody else to the active session", () => {
    expect(defaultSessionFor(tester, "2026-27")).toBe(TEST_SESSION_LABEL);
    expect(defaultSessionFor(office, "2026-27")).toBe("2026-27");
  });
});

describe("an unreadable viewer fails closed", () => {
  it("is a test account with no fee reading: TEST only, never a real session", () => {
    expect(canAccessSession(UNREADABLE_VIEWER, "2026-27")).toBe(false);
    expect(canAccessSession(UNREADABLE_VIEWER, TEST_SESSION_LABEL)).toBe(true);
    expect(isRealAdmin(UNREADABLE_VIEWER)).toBe(false);
    expect(defaultSessionFor(UNREADABLE_VIEWER, "2026-27")).toBe(TEST_SESSION_LABEL);
  });
});

describe("a confined deployment fences every account (D-346)", () => {
  it("only VERCEL_ENV=production is unconfined", () => {
    expect(isConfinedDeployment({ VERCEL_ENV: "production" })).toBe(false);
    expect(isConfinedDeployment({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isConfinedDeployment({})).toBe(true);
  });
});

// Owner, 8 Nov 2026: "the test accounts and QA accounts should be in the test
// session only ... the real live data will only have the genuine accounts".
describe("which staff a session lists", () => {
  it("a test session lists test accounts only; a real session real staff only", () => {
    for (const label of [LABELS.test, LABELS.uat, "DEMO-2026-27"]) {
      expect(staffBelongsToSession(true, label)).toBe(true);
      expect(staffBelongsToSession(false, label)).toBe(false);
    }
    for (const label of [LABELS.real, LABELS.coming]) {
      expect(staffBelongsToSession(false, label)).toBe(true);
      expect(staffBelongsToSession(true, label)).toBe(false);
    }
  });

  it("an unknown flag is a real account, and a missing or malformed label a real session", () => {
    expect(staffBelongsToSession(null, LABELS.real)).toBe(true);
    expect(staffBelongsToSession(undefined, LABELS.test)).toBe(false);
    expect(staffBelongsToSession(false, null)).toBe(true);
    expect(staffBelongsToSession(true, "not-a-session")).toBe(false);
  });

  it("whoever is looking: a real admin in the real year sees real staff, in TEST test accounts", () => {
    const realAdmin = { role: "admin" as const, isTestAccount: false };
    expect(listsTestStaff(realAdmin, LABELS.real)).toBe(false);
    expect(listsTestStaff(realAdmin, LABELS.test)).toBe(true);
    // A test account is always in a test session, whatever label it names.
    expect(listsTestStaff({ role: "admin", isTestAccount: true }, LABELS.real)).toBe(true);
    expect(listsTestStaff({ role: "teacher" }, LABELS.real)).toBe(false);
  });
});
