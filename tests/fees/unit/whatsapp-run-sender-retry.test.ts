import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReminderCandidate, ReminderFilters } from "@/modules/whatsapp/domain/fee-reminders";

/**
 * A failed send is retried, not reported as "already had today's reminder".
 *
 * Today's slot is unique per family, notice and number, and a FAILED attempt
 * held it — so the next press claimed nothing and told the office the family
 * had been reminded when nothing reached them.
 *
 * Ported from the fees app: 1b932785 (the retry) and 31e85d27 (#86, a test
 * session resends a SENT row too). Names and number are test values (rule 6).
 */

vi.mock("server-only", () => ({}));
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

/** Every insert collides; an update finds the row only when its status filter matches. */
function takenSlotClient(existingStatus: "failed" | "sent") {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    from() {
      const builder = {
        insert() {
          const chain = {
            select: () => chain,
            single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }),
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
        update(values: Record<string, unknown>) {
          updates.push(values);
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            in(column: string, values: unknown[]) {
              filters.push([column, values]);
              return chain;
            },
            select: async () => {
              const matches = filters.some(
                ([c, v]) =>
                  c === "status" &&
                  (v === existingStatus || (Array.isArray(v) && v.includes(existingStatus))),
              );
              return { data: matches ? [{ id: "row-1" }] : [], error: null };
            },
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
      };
      return builder;
    },
  };
}

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    studentId: "s1",
    admissionNo: "TEST-001",
    studentName: "Test Child One",
    parentName: "Test Parent One",
    studentClass: "Class 2",
    classId: null,
    classSortOrder: 5,
    transportRoute: null,
    transportFeeAmount: 0,
    destination: "+910000000001",
    usedMotherPhone: false,
    dueAmount: 13250,
    totalPaid: 0,
    balanceDue: 13250,
    prevYearBalance: 0,
    prevSessionLabel: null,
    sentToday: null,
    cadence: "weekly",
    snoozedUntil: null,
    lastSentOn: null,
    lateFeeApplied: 0,
    lateFeeFeesPending: 0,
    lateFeeInstallments: [],
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


beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ ok: true, status: 200, messageId: "msg-1" });
});

const runWith = (client: ReturnType<typeof takenSlotClient>, sessionLabel = "2026-27") =>
  executeReminderRun({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: client as any,
    candidates: [candidate()],
    filters: filters({ sessionLabel }),
    sessionLabel,
    today: "2026-10-27",
    lastDateIso: "2026-10-30",
    campaignName: "vpps_app_fee_due_hi_v6",
    campaignId: null,
    staffId: "staff-1",
    source: "manual",
    scheduledFor: null,
  });

describe("a family whose send failed earlier today", () => {
  it("is sent on the retry, reusing the failed row", async () => {
    const client = takenSlotClient("failed");
    const outcome = await runWith(client);

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
    expect(outcome.alreadySentToday).toBe(0);
    expect(client.updates[0]).toMatchObject({ status: "pending" });
  });

  it("is NOT sent again when today's message actually went", async () => {
    const outcome = await runWith(takenSlotClient("sent"));

    expect(send).not.toHaveBeenCalled();
    expect(outcome.alreadySentToday).toBe(1);
  });
});

describe("a test session", () => {
  it("sends again the same day, reusing today's sent row", async () => {
    const client = takenSlotClient("sent");
    const outcome = await runWith(client, "TEST-2026-27");

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
    expect(client.updates[0]).toMatchObject({ status: "pending" });
  });
});
