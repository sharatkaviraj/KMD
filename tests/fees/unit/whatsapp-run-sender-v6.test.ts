import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReminderCandidate, ReminderFilters } from "@/modules/whatsapp/domain/fee-reminders";

/**
 * What `executeReminderRun` posts once the `_v6` notices are Live (2026-10-26).
 *
 * One template for one child or several, the phone's total in the first line,
 * and a Pay now button whose suffix is the claimed row's own pay code — so the
 * page a parent opens is this send's. How that button reaches AiSensy (as the
 * param after the body's) is pinned in tests/unit/whatsapp-campaigns-v6.test.ts;
 * the generation before v6 is tests/unit/whatsapp-run-sender-family.test.ts.
 */

const send = vi.fn();
vi.mock("@/modules/whatsapp/data/parent-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/whatsapp/data/parent-send")>()),
  sendParentTemplate: (args: unknown) => send(args),
}));
vi.mock("@/modules/whatsapp/data/campaign-store", () => ({
  openRun: async () => "run-1",
  closeRun: async () => undefined,
}));
vi.mock("@/modules/activity/data/events", () => ({
  recordActivity: async () => undefined,
}));

import { executeReminderRun } from "@/modules/whatsapp/data/run-sender";

// VPPS One sends the hub's `_v8` where the fees app sends `_v6` (D-566):
// the same templates, slot for slot, with One's Pay now host, on the school's
// own number. These are the fees app's v6 cases run with every `_v8`
// approved on the hub — the state One reaches once Meta has answered for all
// 22 (20 on 9 Nov 2026). `_v7`, the AiSensy account's, is never approved in
// One. A notice whose `_v8` is not approved yet falls back to the earlier
// text-only generation (tests/fees/unit/whatsapp-campaigns-v7.test.ts).
vi.mock("@/modules/whatsapp/domain/campaign-generation", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/whatsapp/domain/campaign-generation")>();
  const all = new Set(
    real.V8_SITUATIONS.flatMap((situation) =>
      (["hi", "en"] as const).map((language) => real.v8CampaignName(situation, language)),
    ),
  );
  return {
    ...real,
    APPROVED_HUB: all,
    isHubApproved: (situation: Parameters<typeof real.v8CampaignName>[0], language: Parameters<typeof real.v8CampaignName>[1]) =>
      all.has(real.v8CampaignName(situation, language)),
  };
});

// The fees app mocks these once in tests/setup.ts; One has no shared setup
// file, so each ported test carries the same three (go-live Phase D).
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache:
    <T extends (...args: unknown[]) => unknown>(callback: T) =>
    callback,
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});


type Insert = { table: string; rows: Record<string, unknown>[] };

/** Captures every insert; answers claims with an id and everything else with nothing. */
function stubClient(inserts: Insert[]) {
  return {
    from(table: string) {
      const builder = {
        insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
          const list = Array.isArray(rows) ? rows : [rows];
          inserts.push({ table, rows: list });
          const chain = {
            select: () => chain,
            single: async () => ({ data: { id: `${table}-${inserts.length}` }, error: null }),
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      return builder;
    },
  };
}

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    studentId: "s1",
    admissionNo: "TEST-001",
    studentName: "Aaradhya Gurjar",
    parentName: "Ramesh Lal Gurjar",
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
    // The family follows the number unless a test links siblings itself.
    familyKey: overrides.familyKey ?? overrides.destination ?? "+919000000001",
  };
}

function filters(overrides: Partial<ReminderFilters> = {}): ReminderFilters {
  return {
    sessionLabel: "TEST-2026-27",
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
    lastDate: "20-10-2026",
    lateFeeAmount: 1000,
    lateFeeBasis: "per_installment",
    lateFeeSource: "custom",
    policyLateFeeAmount: 1000,
    preDueWindowDays: 10,
    ...overrides,
  };
}

async function run(
  candidates: ReminderCandidate[],
  overrides: Partial<ReminderFilters> = {},
  oneMessagePerFamily?: boolean,
) {
  const inserts: Insert[] = [];
  const outcome = await executeReminderRun({
    supabase: stubClient(inserts),
    candidates,
    filters: filters(overrides),
    sessionLabel: "TEST-2026-27",
    today: "2026-09-04",
    lastDateIso: "2026-10-20",
    campaignName: "vpps_app_fee_due_hi_v2",
    campaignId: null,
    staffId: "staff-1",
    source: "manual",
    scheduledFor: null,
    oneMessagePerFamily,
  });
  const sendRows = inserts
    .filter((entry) => entry.table === "whatsapp_reminder_sends")
    .flatMap((entry) => entry.rows);
  return { outcome, sendRows };
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ ok: true, status: 200, messageId: "msg-1" });
});

type Posted = {
  campaignName: string;
  templateParams: string[];
  buttons?: Array<{ sub_type: string; parameters: Array<{ text: string }> }>;
};

describe("executeReminderRun with the v6 notices Live", () => {
  it("sends a two-child phone ONE v6 message with the phone's total and its own pay code", async () => {
    const { outcome, sendRows } = await run([
      candidate({ studentId: "a", dueAmount: 13250 }),
      candidate({
        studentId: "b",
        admissionNo: "TEST-002",
        studentName: "Bhavya Gurjar",
        studentClass: "Class 5",
        dueAmount: 9125,
      }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.campaignName).toBe("vpps_app_fee_due_hi_v8");
    // The body's five slots; the pay code is NOT one of them here.
    expect(posted.templateParams).toHaveLength(5);
    expect(posted.templateParams[0]).toBe("22,375");

    const claim = sendRows.find((row) => row.status === "pending")!;
    expect(claim.campaign_name).toBe("vpps_app_fee_due_hi_v8");
    expect(claim.due_amount).toBe(22375);
    expect(typeof claim.pay_code).toBe("string");
    expect(posted.buttons).toEqual([
      expect.objectContaining({
        sub_type: "url",
        parameters: [expect.objectContaining({ text: claim.pay_code })],
      }),
    ]);

    const covered = sendRows.find((row) => row.status === "covered_by_sibling")!;
    expect(covered.campaign_name).toBe("vpps_app_fee_due_hi_v8");
    expect(outcome.sent).toBe(1);
  });

  it("sends a one-child phone the same v6 template", async () => {
    await run([candidate()]);
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.campaignName).toBe("vpps_app_fee_due_hi_v8");
    expect(posted.templateParams).toHaveLength(5);
    expect(posted.buttons).toHaveLength(1);
  });

  it("sends late_fee_applied with no Pay now button", async () => {
    // Its headline is fees plus late fee; the pay page shows fees only.
    await run([candidate({ lateFeeApplied: 1000, lateFeeInstallments: [2] })], {
      situation: "late_fee_applied",
      language: "en",
      installments: [2],
    });
    const posted = send.mock.calls[0]![0] as Posted;
    // It has no Pay now and so no `_v8`; One never sends `_v6`, so it goes
    // out under the earlier text-only generation (go-live plan §6.2).
    expect(posted.campaignName).toBe("vpps_app_late_fee_applied_en_v3");
    expect(posted.buttons).toBeUndefined();
  });
});

describe("slot 3 names the installments the family owes, not every tile", () => {
  it("tells a family who paid installment 1 that it owes installment 2", async () => {
    // 27 October: installments [1, 2], "owing on any of them" — everybody read
    // "किश्त 1 एवं 2", including families who had paid installment 1.
    await run([candidate({ owedInstallments: [2] })], { installmentMatch: "any" });
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.templateParams[2]).toBe("किश्त 2");
  });

  it("names every installment any child on the phone owes", async () => {
    await run([
      candidate({ studentId: "a", owedInstallments: [2] }),
      candidate({
        studentId: "b",
        admissionNo: "TEST-002",
        studentName: "Bhavya Gurjar",
        studentClass: "Class 5",
        owedInstallments: [1, 2],
      }),
    ]);
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.templateParams[2]).toBe("किश्त 1 एवं 2");
  });
});

describe("the Pay now amount is the figure the message prints", () => {
  it("stores the Balance notice's headline, not the selected tiles' fees", async () => {
    const { sendRows } = await run([candidate({ dueAmount: 14125, balanceDue: 23250 })], {
      situation: "balance",
    });
    const posted = send.mock.calls[0]![0] as Posted;
    expect(posted.templateParams[0]).toBe("23,250");
    const claim = sendRows.find((row) => row.status === "pending")!;
    expect(claim.due_amount).toBe(23250);
  });
});
