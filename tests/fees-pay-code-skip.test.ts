import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CutoverWatermark } from "@/platform/migration/cutover-watermark";
import type { ReminderCandidate, ReminderFilters } from "@/modules/whatsapp/domain/fee-reminders";

/**
 * critique0 #4 (go-live Phase E review): under either tail option, One's
 * sender gives no Pay now to a family that can still pay through a link the
 * fees app sent — Path A until `pay_code_expires_on` (none = for good), Path
 * B until 21 days after it went. They get the text-only notice instead. A
 * TEST session is never held back.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

let watermark: CutoverWatermark = { state: "at", at: "2026-12-13T00:30:00Z", source: "cutover" };
vi.mock("@/platform/migration/cutover-watermark-reader", () => ({
  readCutoverWatermark: async () => watermark,
}));

const send = vi.fn();
vi.mock("@/modules/whatsapp/data/aisensy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/whatsapp/data/aisensy")>()),
  sendAisensyCampaignMessage: (args: unknown) => send(args),
}));
vi.mock("@/modules/whatsapp/data/campaign-store", () => ({ openRun: async () => "run-1", closeRun: async () => undefined }));
vi.mock("@/modules/activity/data/events", () => ({ recordActivity: async () => undefined }));
vi.mock("@/modules/whatsapp/domain/campaign-generation", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/whatsapp/domain/campaign-generation")>();
  const all = new Set(
    real.V7_SITUATIONS.flatMap((situation) => (["hi", "en"] as const).map((language) => real.v7CampaignName(situation, language))),
  );
  return {
    ...real,
    APPROVED_V7: all,
    isV7Approved: (situation: Parameters<typeof real.v7CampaignName>[0], language: Parameters<typeof real.v7CampaignName>[1]) =>
      all.has(real.v7CampaignName(situation, language)),
  };
});

import { familyHoldsFeesPayCode, loadFeesPayCodeHolders } from "@/modules/whatsapp/data/fees-pay-codes";
import { executeReminderRun } from "@/modules/whatsapp/data/run-sender";
import { feesPayCodeStillPayable } from "@/platform/migration/cutover-watermark";

const AT: CutoverWatermark = { state: "at", at: "2026-12-13T00:30:00Z", source: "cutover" };
const TODAY = "2026-12-20";
const BEFORE = "2026-12-12T10:00:00Z";

afterEach(() => {
  vi.clearAllMocks();
});

describe("is a fees pay code still payable?", () => {
  const base = { created_at: BEFORE, session_label: "2026-27", pay_code: "code" };

  it("Path A: until pay_code_expires_on, and for good with no expiry", () => {
    expect(feesPayCodeStillPayable({ ...base, pay_code_expires_on: "2026-12-20" }, AT, TODAY)).toBe(true);
    expect(feesPayCodeStillPayable({ ...base, pay_code_expires_on: "2027-01-31" }, AT, TODAY)).toBe(true);
    expect(feesPayCodeStillPayable({ ...base, pay_code_expires_on: "2026-12-19" }, AT, TODAY)).toBe(false);
    expect(feesPayCodeStillPayable({ ...base, pay_code_expires_on: null }, AT, TODAY)).toBe(true);
  });

  it("Path B: for 21 days after it went, whatever its printed date", () => {
    const pathB = { ...base, pay_scope: { studentIds: ["a"] }, pay_code_expires_on: "2026-12-01" };
    // Sent 12 Dec (IST): open to 2 Jan.
    expect(feesPayCodeStillPayable(pathB, AT, "2027-01-02")).toBe(true);
    expect(feesPayCodeStillPayable(pathB, AT, "2027-01-03")).toBe(false);
  });

  it("only the fees app's own codes: not One's, not TEST, not before any load", () => {
    const pathA = { ...base, pay_code_expires_on: "2027-01-31" };
    expect(feesPayCodeStillPayable({ ...pathA, created_at: "2026-12-14T00:00:00Z" }, AT, TODAY)).toBe(false);
    expect(feesPayCodeStillPayable({ ...pathA, session_label: "TEST-2026-27" }, AT, TODAY)).toBe(false);
    expect(feesPayCodeStillPayable(pathA, { state: "none" }, TODAY)).toBe(false);
    expect(feesPayCodeStillPayable({ ...pathA, pay_code: null }, AT, TODAY)).toBe(false);
    // An unreadable line counts the row as the fees app's.
    expect(feesPayCodeStillPayable(pathA, { state: "unreadable" }, TODAY)).toBe(true);
  });
});

type SendRow = Record<string, unknown>;

/** A client whose reminder-send reads return `sendRows`, and which records inserts. */
function client(sendRows: SendRow[], inserts: Array<{ table: string; rows: SendRow[] }> = []) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "not", "lt", "or", "order", "eq", "gte", "range"]) chain[method] = () => chain;
      chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: table === "whatsapp_reminder_sends" && chain.__read ? sendRows : [], error: null });
      chain.select = (columns: string) => {
        chain.__read = String(columns).includes("pay_code_expires_on");
        return chain;
      };
      chain.insert = (rows: SendRow | SendRow[]) => {
        inserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
        const done = {
          select: () => done,
          single: async () => ({ data: { id: `${table}-${inserts.length}` }, error: null }),
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        };
        return done;
      };
      chain.update = () => ({ eq: async () => ({ error: null }) });
      return chain;
    },
  };
}

describe("loading the holders", () => {
  beforeEach(() => {
    watermark = AT;
  });

  it("marks the row's child, every child in its scope, and its phone", async () => {
    const holders = await loadFeesPayCodeHolders(
      client([
        { student_id: "a", destination: "+919000000001", session_label: "2026-27", created_at: BEFORE, pay_code: "x", pay_code_expires_on: "2027-01-31", pay_scope: { studentIds: ["a", "b"] } },
        { student_id: "c", destination: "+919000000003", session_label: "2026-27", created_at: BEFORE, pay_code: "y", pay_code_expires_on: "2026-12-01", pay_scope: null },
      ]),
      { studentIds: ["b"], destinations: [], today: TODAY },
    );
    expect(holders && [...holders.studentIds].sort()).toEqual(["a", "b"]);
    expect(holders && [...holders.destinations]).toEqual(["+919000000001"]);
  });

  it("holds nobody before any real data was loaded, and everybody when the line cannot be read", async () => {
    watermark = { state: "none" };
    expect(await loadFeesPayCodeHolders(client([]), { studentIds: ["a"], destinations: [], today: TODAY })).toEqual({
      studentIds: new Set(),
      destinations: new Set(),
    });
    watermark = { state: "unreadable" };
    const holders = await loadFeesPayCodeHolders(client([]), { studentIds: ["a"], destinations: [], today: TODAY });
    expect(holders).toBeNull();
    expect(familyHoldsFeesPayCode(holders, { studentIds: ["z"], destinations: [] })).toBe(true);
  });
});

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    studentId: "s1",
    admissionNo: "TEST-001",
    studentName: "Sample Child",
    parentName: "Sample Parent",
    studentClass: "Class 2",
    classId: null,
    classSortOrder: 5,
    transportRoute: null,
    transportFeeAmount: 0,
    destination: "+919000000001",
    usedMotherPhone: false,
    dueAmount: 13250,
    totalPaid: 0,
    balanceDue: 13250,
    prevYearBalance: 0,
    prevSessionLabel: null,
    sentToday: null,
    cadence: "weekly",
    snoozedUntil: null,
    profile: "standard",
    profileSource: "suggested",
    profileReason: "Late on installment 1",
    lastSentOn: null,
    lateFeeApplied: 0,
    lateFeeFeesPending: 0,
    lateFeeInstallments: [],
    owedInstallments: [],
    overdueInstallments: [],
    promisedOn: null,
    promiseContactedOn: null,
    preferredLanguage: null,
    secondaryDestination: null,
    sentCount: 0,
    includedByHand: false,
    missingFacts: [],
    missingFactsLabel: "",
    ...overrides,
    familyKey: overrides.familyKey ?? overrides.destination ?? "+919000000001",
  };
}

function filters(sessionLabel: string): ReminderFilters {
  return {
    sessionLabel,
    installments: [1, 2],
    lastYear: false,
    installmentMatch: "all",
    paid: "any",
    minDueAmount: 1,
    lateFee: "any",
    promise: "skip_open",
    skipOverdue: false,
    classId: null,
    includeRte: false,
    profiles: ["on_time", "standard", "chronic"],
    includeStudentIds: [],
    excludeStudentIds: [],
    situation: "fee_due",
    language: "hi",
    lastDate: "20-12-2026",
    lateFeeAmount: 1000,
    lateFeeBasis: "per_installment",
    lateFeeSource: "custom",
    policyLateFeeAmount: 1000,
    preDueWindowDays: 10,
  };
}

async function runWith(sessionLabel: string, sendRows: SendRow[]) {
  return executeReminderRun({
    supabase: client(sendRows),
    candidates: [candidate()],
    filters: filters(sessionLabel),
    sessionLabel,
    today: TODAY,
    lastDateIso: "2026-12-20",
    campaignName: "vpps_app_fee_due_hi_v2",
    campaignId: null,
    staffId: "staff-1",
    source: "manual",
    scheduledFor: null,
  });
}

type Posted = { campaignName: string; buttons?: unknown[] };

describe("the run sender", () => {
  beforeEach(() => {
    watermark = AT;
    send.mockReset();
    send.mockResolvedValue({ ok: true, status: 200, messageId: "msg-1" });
  });

  const feesCode = { student_id: "s1", destination: "+919000000001", session_label: "2026-27", created_at: BEFORE, pay_code: "fees", pay_code_expires_on: "2027-01-31", pay_scope: null };

  it("sends the text-only notice to a family with a payable fees code", async () => {
    const outcome = await runWith("2026-27", [feesCode]);
    expect(outcome.sent).toBe(1);
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.campaignName).not.toMatch(/_v7$/);
    expect(posted.buttons).toBeUndefined();
  });

  it("sends Pay now once the fees code has expired", async () => {
    await runWith("2026-27", [{ ...feesCode, pay_code_expires_on: "2026-12-19" }]);
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.campaignName).toBe("vpps_app_fee_due_hi_v7");
    expect(posted.buttons).toHaveLength(1);
  });

  it("sends no Pay now to anybody when the line cannot be read", async () => {
    watermark = { state: "unreadable" };
    await runWith("2026-27", []);
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.buttons).toBeUndefined();
  });

  it("never holds back a TEST session", async () => {
    await runWith("TEST-2026-27", [{ ...feesCode, session_label: "2026-27" }]);
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.campaignName).toBe("vpps_app_fee_due_hi_v7");
    expect(posted.buttons).toHaveLength(1);
  });
});
