import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReminderCandidate, ReminderFilters } from "@/modules/whatsapp/domain/fee-reminders";
import type { LedgerRecheck } from "@/modules/whatsapp/data/run-sender";

/**
 * The sender's last look at the ledger, with online payments switched on.
 *
 * A one-child Pay now message is re-quoted the instant before it goes: a
 * family who paid since the list was built is not chased, a figure the ledger
 * no longer agrees with is not sent, and a ledger that cannot be read sends
 * nothing with a Pay now link. The amount the send row stores is the number
 * slot 1 was formatted from — never parsed back out of it. Harness copied from
 * tests/unit/whatsapp-run-sender-v6.test.ts.
 */

const send = vi.fn();
vi.mock("@/modules/whatsapp/data/aisensy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/whatsapp/data/aisensy")>()),
  sendAisensyCampaignMessage: (args: unknown) => send(args),
}));
vi.mock("@/modules/whatsapp/data/campaign-store", () => ({
  openRun: async () => "run-1",
  closeRun: async () => undefined,
}));
vi.mock("@/modules/activity/data/events", () => ({
  recordActivity: async () => undefined,
}));

import { executeReminderRun } from "@/modules/whatsapp/data/run-sender";

// VPPS One sends `_v7` where the fees app sends `_v6` (go-live plan §6.2):
// the same templates, slot for slot, with One's Pay now host. These are the
// fees app's v6 cases run with every `_v7` approved — the state One reaches
// once the owner reports them Live. Until then `APPROVED_V7` is empty and
// the earlier text-only generation goes (tests/fees/unit/whatsapp-campaigns-v7.test.ts).
vi.mock("@/modules/whatsapp/domain/campaign-generation", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/whatsapp/domain/campaign-generation")>();
  const all = new Set(
    real.V7_SITUATIONS.flatMap((situation) =>
      (["hi", "en"] as const).map((language) => real.v7CampaignName(situation, language)),
    ),
  );
  return {
    ...real,
    APPROVED_V7: all,
    isV7Approved: (situation: Parameters<typeof real.v7CampaignName>[0], language: Parameters<typeof real.v7CampaignName>[1]) =>
      all.has(real.v7CampaignName(situation, language)),
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


async function run(candidates: ReminderCandidate[], recheckLedger?: LedgerRecheck) {
  const inserts: Insert[] = [];
  const outcome = await executeReminderRun({
    supabase: stubClient(inserts),
    candidates,
    filters: filters(),
    sessionLabel: "TEST-2026-27",
    today: "2026-09-04",
    lastDateIso: "2026-10-20",
    campaignName: "vpps_app_fee_due_hi_v2",
    campaignId: null,
    staffId: "staff-1",
    source: "manual",
    scheduledFor: null,
    recheckLedger,
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

const one = () => candidate({ studentId: "a", dueAmount: 13250, owedInstallments: [1, 2] });

describe("the scope a Pay now link carries", () => {
  it("writes the student, the installments and the NUMBER slot 1 printed", async () => {
    const { sendRows } = await run([one()]);
    const claim = sendRows.find((row) => row.status === "pending")!;
    expect(claim.due_amount).toBe(13250);
    expect(claim.pay_scope).toEqual({ studentIds: ["a"], installments: [1, 2], lastYear: false, situation: "fee_due", amount: 13250 });
  });

  it("a two-child phone's scope names both children, so the pay page keeps the UPI panel", async () => {
    const { sendRows } = await run([one(), candidate({ studentId: "b", admissionNo: "TEST-002", dueAmount: 9125, owedInstallments: [2] })]);
    const claim = sendRows.find((row) => row.status === "pending")!;
    expect((claim.pay_scope as { studentIds: string[] }).studentIds).toEqual(["a", "b"]);
    expect(claim.due_amount).toBe(22375);
  });
});

describe("the last look at the ledger", () => {
  it("without a recheck the run is exactly what it was", async () => {
    const { outcome } = await run([one()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.stoppedByLedger).toBe(0);
  });

  it("sends when the ledger agrees", async () => {
    const recheck = vi.fn(async () => ({ total: 13250, eligible: true, reasons: [] }));
    const { outcome } = await run([one()], recheck);
    expect(recheck).toHaveBeenCalledWith({ studentId: "a", installments: [1, 2], lastYear: false, situation: "fee_due" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
  });

  it("does not chase a family who paid since the list was built", async () => {
    const { outcome, sendRows } = await run([one()], async () => ({ total: 0, eligible: false, reasons: ["nothing_due"] }));
    expect(send).not.toHaveBeenCalled();
    expect(sendRows).toHaveLength(0);
    expect(outcome.stoppedByLedger).toBe(1);
    expect(outcome.failures[0]?.error).toMatch(/Paid since/);
  });

  it("does not send a figure the ledger no longer agrees with", async () => {
    const { outcome } = await run([one()], async () => ({ total: 6125, eligible: true, reasons: [] }));
    expect(send).not.toHaveBeenCalled();
    expect(outcome.failures[0]?.error).toMatch(/amount changed/);
  });

  it("fails closed when the ledger cannot be read", async () => {
    const { outcome } = await run([one()], async () => null);
    expect(send).not.toHaveBeenCalled();
    expect(outcome.stoppedByLedger).toBe(1);
  });

  it("still sends when the quote is not online-eligible (a late fee): the pay page keeps UPI", async () => {
    await run([one()], async () => ({ total: 14250, eligible: false, reasons: ["late_fee_pending"] }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is not asked about a family message", async () => {
    const recheck = vi.fn(async () => null);
    await run([one(), candidate({ studentId: "b", admissionNo: "TEST-002", dueAmount: 9125 })], recheck);
    expect(recheck).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves a notice it does not apply to alone", async () => {
    await run([one()], async () => "not_applicable");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("deployed before the migration", () => {
  it("still sends when the database has no pay_scope column yet", async () => {
    const inserts: Insert[] = [];
    const base = stubClient(inserts);
    // The first claim carrying `pay_scope` is refused the way PostgREST refuses
    // an unknown column; the retry without it succeeds.
    let refused = 0;
    const client = {
      from(table: string) {
        const real = base.from(table);
        return {
          ...real,
          insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
            const list = Array.isArray(rows) ? rows : [rows];
            if (table === "whatsapp_reminder_sends" && list.some((row) => "pay_scope" in row)) {
              refused += 1;
              const chain = {
                select: () => chain,
                single: async () => ({
                  data: null,
                  error: { code: "PGRST204", message: "Could not find the 'pay_scope' column of 'whatsapp_reminder_sends' in the schema cache" },
                }),
              };
              return chain;
            }
            return real.insert(rows);
          },
        };
      },
    };
    const outcome = await executeReminderRun({
      supabase: client,
      candidates: [one()],
      filters: filters(),
      sessionLabel: "TEST-2026-27",
      today: "2026-09-04",
      lastDateIso: "2026-10-20",
      campaignName: "vpps_app_fee_due_hi_v2",
      campaignId: null,
      staffId: "staff-1",
      source: "manual",
      scheduledFor: null,
    });
    expect(refused).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
    const claim = inserts.find((entry) => entry.table === "whatsapp_reminder_sends")!.rows[0]!;
    expect(claim).not.toHaveProperty("pay_scope");
    expect(claim.due_amount).toBe(13250);
  });
});
